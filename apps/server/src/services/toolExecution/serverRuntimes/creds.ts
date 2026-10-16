import { CredsIdentifier, type ICredsService } from '@lobechat/builtin-tool-creds';
import { CredsExecutionRuntime } from '@lobechat/builtin-tool-creds/executionRuntime';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { MarketService } from '@/server/services/market';
import {
  createSandboxService,
  getSandboxProviderKind,
  resolveSandboxSessionConfig,
  type SandboxService,
} from '@/server/services/sandbox';
import { maskCredentialEnv } from '@/server/services/sandbox/credentials';

import { resolveContentWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:creds-runtime');

/**
 * Server-side Creds Service implementation
 * Wraps MarketService.market.creds to provide ICredsService interface
 */
export class ServerCredsService implements ICredsService {
  private marketService: MarketService;
  private workspaceId?: string;

  private isShareVisitor: boolean;

  /**
   * The sandbox this run's credentials belong in, when the deployment owns that
   * sandbox (Onlyboxes). Absent on the Market provider, where Market injects
   * into its own sandbox and there is nothing for this process to write.
   */
  private sandboxService?: SandboxService;

  constructor(
    marketService: MarketService,
    workspaceId?: string,
    /**
     * Belt-and-braces guard: true for an Agent Share visitor's run
     * (`context.agentShareVisitor` set). `lobe-creds` is already absent from
     * `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`, so this runtime should never
     * be constructed for a visitor in the first place — but `injectCreds`
     * refuses again here too, so the guarantee that the creator's decrypted
     * credentials never land in a sandbox a visitor controls doesn't rest on
     * the allowlist alone.
     */
    isShareVisitor = false,
    sandboxService?: SandboxService,
  ) {
    this.marketService = marketService;
    this.workspaceId = workspaceId;
    this.isShareVisitor = isShareVisitor;
    this.sandboxService = sandboxService;
  }

  /**
   * Inside a workspace, reads/writes must hit the workspace's shared organization
   * credentials, never the operator's personal creds. Falls back to
   * the personal `market.creds` namespace outside a workspace.
   */
  private credsAccessor() {
    return this.workspaceId
      ? this.marketService.market.organizations.creds({ workspaceId: this.workspaceId })
      : this.marketService.market.creds;
  }

  async getByKey(
    key: string,
    options?: { decrypt?: boolean },
  ): Promise<{
    fileName?: string;
    fileUrl?: string;
    name?: string;
    plaintext?: Record<string, string>;
    type: string;
    values?: Record<string, string>;
  }> {
    log('getByKey: key=%s, decrypt=%s', key, options?.decrypt);

    // First find the credential by key from the list
    const listResult = await this.credsAccessor().list();
    const cred = listResult.data?.find((c) => c.key === key);

    if (!cred) {
      throw new Error(`Credential not found: ${key}`);
    }

    // Then get the full credential with optional decryption
    const result = await this.credsAccessor().get(cred.id, {
      decrypt: options?.decrypt,
    });

    log('getByKey success: key=%s, id=%d', key, cred.id);

    return result as any;
  }

  async getOAuthAuthorizeUrl(
    provider: string,
    redirectUri: string,
  ): Promise<{
    authorizeUrl: string;
  }> {
    log('getOAuthAuthorizeUrl: provider=%s', provider);

    const response = await this.marketService.market.connect.authorize(provider, {
      redirect_uri: redirectUri,
    });

    return {
      authorizeUrl: response.authorize_url,
    };
  }

  async getOAuthConnectionStatus(provider: string): Promise<{
    connected: boolean;
  }> {
    log('getOAuthConnectionStatus: provider=%s', provider);

    const response = await this.marketService.market.connect.getStatus(provider);

    return {
      connected: response.connected,
    };
  }

  async injectCreds(params: {
    keys: string[];
    sandbox?: boolean;
    topicId: string;
    userId: string;
  }): Promise<{
    credentials?: {
      env?: Record<string, string>;
      files?: Array<{ filename: string; key: string; path: string }>;
    };
    notFound?: string[];
    success: boolean;
    unsupportedInSandbox?: string[];
  }> {
    log('injectCreds: keys=%O, topicId=%s', params.keys, params.topicId);

    // Refuse before the Market call, not after: Market's inject endpoint
    // writes the creator's REAL credentials into the sandbox's ~/.creds/env
    // server-side as part of handling the request (see the comment below),
    // so for a share visitor the only safe place to stop is here.
    if (this.isShareVisitor) {
      throw new Error(
        'Credential injection into the sandbox is unavailable in shared conversations.',
      );
    }

    if (getSandboxProviderKind() === 'onlyboxes') {
      return this.injectCredsIntoOnlyboxesSandbox(params);
    }

    // Market's generic inject endpoint resolves organization credentials from
    // the workspaceId signed into this service's trusted-client token, and —
    // when `sandbox` is true (the default) — already writes the *real*
    // (unmasked) values into the sandbox's ~/.creds/env server-side before
    // responding. The `credentials.env` map in that response is masked for
    // safe display to the model, so it must never be written into the
    // sandbox again here: an earlier version of this method did exactly
    // that, appending a masked `export` line after market's real one. Since
    // re-sourcing ~/.creds/env applies `export`s in file order, the masked
    // line silently shadowed the real credential for every later command.
    const result = await this.marketService.market.creds.inject({
      keys: params.keys,
      sandbox: params.sandbox,
      topicId: params.topicId,
      userId: params.userId,
    });

    log('injectCreds success: notFound=%d', result.notFound?.length || 0);

    return result as any;
  }

  /**
   * The Onlyboxes path. Market still resolves and decrypts the credentials (the
   * credential store lives there), but it must NOT perform the sandbox write —
   * this deployment's sandbox is the Onlyboxes one, which only this process can
   * reach. So Market is asked to resolve without a sandbox write, and this
   * method writes the real values into the Onlyboxes sandbox itself, returning
   * only a masked map for the model.
   */
  private async injectCredsIntoOnlyboxesSandbox(params: {
    keys: string[];
    sandbox?: boolean;
    topicId: string;
    userId: string;
  }): Promise<{
    credentials?: {
      env?: Record<string, string>;
      files?: Array<{ filename: string; key: string; path: string }>;
    };
    notFound?: string[];
    success: boolean;
    unsupportedInSandbox?: string[];
  }> {
    if (!this.sandboxService) {
      throw new Error('Sandbox credential writer is not configured');
    }

    // Market's `inject` endpoint never returns the real values — it only ever
    // emits a masked preview, because when it is asked to inject (`sandbox:
    // true`) it writes the plaintext into ITS OWN sandbox and nothing needs to
    // leave the response. This deployment's sandbox is the Onlyboxes one, so the
    // plaintext must be resolved here instead: `creds.get(decrypt: true)` is the
    // one Market read that returns real values, and it does so for KV creds.
    const accessor = this.credsAccessor();
    const list = await accessor.list();
    const byKey = new Map((list.data ?? []).map((cred) => [cred.key, cred]));

    const env: Record<string, string> = {};
    const notFound: string[] = [];
    const unsupportedInSandbox: string[] = [];

    for (const key of params.keys) {
      const cred = byKey.get(key);
      if (!cred) {
        notFound.push(key);
        continue;
      }

      if (cred.type !== 'kv-env') {
        // kv-header is never sandbox-injectable, and oauth/file carry no
        // decryptable plaintext, so none of them can be written into a sandbox
        // this process owns.
        unsupportedInSandbox.push(key);
        continue;
      }

      const full = (await accessor.get(cred.id, { decrypt: true })) as {
        plaintext?: Record<string, string>;
      };
      Object.assign(env, full.plaintext ?? {});
    }

    if (Object.keys(env).length > 0) {
      await this.sandboxService.writeCredentials({ env });
    }

    log(
      'injectCreds (onlyboxes) done: written=%d notFound=%d unsupported=%d',
      Object.keys(env).length,
      notFound.length,
      unsupportedInSandbox.length,
    );

    return {
      credentials: { env: maskCredentialEnv(env), files: [] },
      notFound,
      success: notFound.length === 0,
      unsupportedInSandbox,
    };
  }

  async listCreds(): Promise<{
    data?: Array<{ id: number; key: string }>;
  }> {
    log('listCreds');

    const result = await this.credsAccessor().list();

    log('listCreds success: %d credentials', result.data?.length || 0);

    return result as any;
  }

  async saveKVCred(params: {
    description?: string;
    key: string;
    name: string;
    type: 'kv-env' | 'kv-header';
    values: Record<string, string>;
  }): Promise<{ id: number }> {
    log('saveKVCred: key=%s, name=%s, type=%s', params.key, params.name, params.type);

    const result = await this.credsAccessor().createKV(params);

    log('saveKVCred success: id=%d', result.id);

    return result;
  }
}

/**
 * Creds Server Runtime
 * Per-request runtime (needs userId, topicId)
 */
export const credsRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Creds execution');
    }

    // Recovered, not read off the context: the dispatch and resume paths drop
    // it, and credentials must be injected into the SAME sandbox session the
    // commands run in — the sandbox runtimes recover it the same way.
    const workspaceId = await resolveContentWorkspaceId(context);

    if (workspaceId) {
      if (!context.serverDB) {
        throw new Error('serverDB is required for workspace Creds execution');
      }

      const membership = await new WorkspaceMemberModel(context.serverDB, context.userId).getMember(
        workspaceId,
        context.userId,
      );
      if (!membership) {
        throw new Error('Workspace membership is required for workspace Creds execution');
      }
    }

    log(
      'Creating CredsExecutionRuntime for userId=%s, topicId=%s, workspaceId=%s',
      context.userId,
      context.topicId,
      workspaceId,
    );

    // Read market accessToken from DB so server-side creds runtime can authenticate.
    let accessToken: string | undefined;
    if (context.serverDB) {
      try {
        const userModel = new UserModel(context.serverDB, context.userId);
        const settings = await userModel.getUserSettings();
        accessToken = (settings?.market as any)?.accessToken;
      } catch {
        // non-fatal — MarketService will fall back to trustedClientToken
      }
    }

    // Credentials are injected INTO a sandbox, so this call has to agree with
    // the cloud-sandbox and skills runtimes about which one. A token without the
    // entitlement routes to the ephemeral runtime, and the injection lands in a
    // different sandbox than the commands that need it — or tears down the live
    // one on the way.
    const sandbox = await resolveSandboxSessionConfig({
      isShareVisitorRun: Boolean(context.agentShareVisitor),
      serverDB: context.serverDB,
      topicId: context.topicId,
      userId: context.userId,
      workspaceId,
    });

    const marketService = new MarketService({
      accessToken,
      userInfo: {
        sandboxStorage: sandbox.claim,
        userId: context.userId,
        workspaceId,
      },
    });

    // Only the Onlyboxes provider needs a sandbox writer: Market injects into
    // its own sandbox upstream, so building one there would be dead weight and
    // an extra dependency on a provider this run will never touch. A run with no
    // topicId cannot inject anyway — the runtime refuses before reaching the
    // service — so it is left without a writer.
    const sandboxService: SandboxService | undefined =
      getSandboxProviderKind() === 'onlyboxes' && context.topicId
        ? createSandboxService({
            marketService,
            sandboxCwd: sandbox.cwd,
            sandboxInstanceId: sandbox.environment,
            sandboxMode: sandbox.mode,
            sandboxSpecification: sandbox.specification,
            sandboxWorkingDir: sandbox.workingDir,
            serverDB: context.serverDB,
            topicId: context.topicId,
            userId: context.userId,
          })
        : undefined;

    const credsService = new ServerCredsService(
      marketService,
      workspaceId,
      Boolean(context.agentShareVisitor),
      sandboxService,
    );

    return new CredsExecutionRuntime(credsService, {
      topicId: context.topicId,
      userId: context.userId,
    });
  },
  identifier: CredsIdentifier,
};
