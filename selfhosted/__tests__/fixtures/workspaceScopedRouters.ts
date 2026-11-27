/**
 * WS-6 inventory of every source file that composes a workspace-scoped tRPC
 * procedure.
 *
 * Check 2 of the scope-isolation suite ('cross-workspace denial') is an
 * enumeration, not a sample: the suite rescans the tree on every run and fails
 * when this list and the tree disagree. Adding a router that composes
 * `wsProcedure`, `wsMemberProcedure` or `wsCompatProcedure` therefore requires
 * touching this file, which is the point — a new workspace surface must be
 * considered by the phase gate.
 *
 * `routerPath` is the aggregate-router path the module contributes to:
 * `lambdaRouter` for `apps/server/src/routers/lambda/**` and
 * `packages/business-server/src/lambda-routers/**`, `toolsRouter` for
 * `apps/server/src/routers/tools/**`. A few modules contribute under a
 * differently-named router and are mapped explicitly below (`agentGroup` →
 * `group`, `goalProcedures` → `goal`, `deviceWorkspaceWorkingDirs` → `device`,
 * `_helpers/agentBotProviderProcedure` → `agentBotProvider`, and the three
 * `tools/*` routers → `tools`).
 *
 * Do not edit by hand to make a failure go away: a drift here means a router
 * changed its scope, and the matrix must be extended deliberately.
 */
export interface WorkspaceScopedSource {
  file: string;
  routerPath: string;
  uses: Array<'wsCompatProcedure' | 'wsMemberProcedure' | 'wsProcedure'>;
}

export const WORKSPACE_SCOPED_SOURCES: WorkspaceScopedSource[] = [
  {
    file: 'apps/server/src/routers/lambda/acceptance/procedures.ts',
    routerPath: 'acceptance',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentAccount.ts',
    routerPath: 'agentAccount',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentDocument/procedures.ts',
    routerPath: 'agentDocument',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentEvalExternal.ts',
    routerPath: 'agentEvalExternal',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentEval/procedures.ts',
    routerPath: 'agentEval',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentGroup/procedures.ts',
    routerPath: 'group',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentLabel.ts',
    routerPath: 'agentLabel',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentNotify.ts',
    routerPath: 'agentNotify',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agent/procedures.ts',
    routerPath: 'agent',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentRunBoard.ts',
    routerPath: 'agentRunBoard',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentShare.ts',
    routerPath: 'agentShare',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentSignal.ts',
    routerPath: 'agentSignal',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentSkills.ts',
    routerPath: 'agentSkills',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentSteerQueue.ts',
    routerPath: 'agentSteerQueue',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/agentTrace.ts',
    routerPath: 'agentTrace',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/aiAgent/procedures.ts',
    routerPath: 'aiAgent',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/aiChat.ts',
    routerPath: 'aiChat',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/aiModel.ts',
    routerPath: 'aiModel',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/aiProvider.ts',
    routerPath: 'aiProvider',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/apiKey.ts',
    routerPath: 'apiKey',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/artboard.ts',
    routerPath: 'artboard',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/asr.ts',
    routerPath: 'asr',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/auth.ts',
    routerPath: 'auth',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/botMessage.ts',
    routerPath: 'botMessage',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/brief.ts',
    routerPath: 'brief',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/canvas.ts',
    routerPath: 'canvas',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/chunk.ts',
    routerPath: 'chunk',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/composio.ts',
    routerPath: 'composio',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/connector/index.ts',
    routerPath: 'connector',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/connector/procedures.ts',
    routerPath: 'connector',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/dashboard.ts',
    routerPath: 'dashboard',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/deviceMetric.ts',
    routerPath: 'deviceMetric',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/device/procedures.ts',
    routerPath: 'device',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/device/workspace.ts',
    routerPath: 'device',
    uses: ['wsProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/deviceWorkspaceWorkingDirs.ts',
    routerPath: 'device',
    uses: ['wsProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/documentComment.ts',
    routerPath: 'documentComment',
    uses: ['wsProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/documentLike.ts',
    routerPath: 'documentLike',
    uses: ['wsProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/document.ts',
    routerPath: 'document',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/environment.ts',
    routerPath: 'environment',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/expertise.ts',
    routerPath: 'expertise',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/exporter.ts',
    routerPath: 'exporter',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/favorite.ts',
    routerPath: 'favorite',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/file/procedures.ts',
    routerPath: 'file',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/followUpAction.ts',
    routerPath: 'followUpAction',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/generationBatch.ts',
    routerPath: 'generationBatch',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/generationTopic.ts',
    routerPath: 'generationTopic',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/generation.ts',
    routerPath: 'generation',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/goalProcedures.ts',
    routerPath: 'goal',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/_helpers/agentBotProviderProcedure.ts',
    routerPath: 'agentBotProvider',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/home.ts',
    routerPath: 'home',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/image/index.ts',
    routerPath: 'image',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/importer.ts',
    routerPath: 'importer',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/inboundWebhook.ts',
    routerPath: 'inboundWebhook',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/knowledgeBase.ts',
    routerPath: 'knowledgeBase',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/knowledge.ts',
    routerPath: 'knowledge',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/linear.ts',
    routerPath: 'linear',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/meeting.ts',
    routerPath: 'meeting',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/message.ts',
    routerPath: 'message',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/metric.ts',
    routerPath: 'metric',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/music/index.ts',
    routerPath: 'music',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/notebook.ts',
    routerPath: 'notebook',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/notification.ts',
    routerPath: 'notification',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/oauthApp.ts',
    routerPath: 'oauthApp',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/oauthDeviceFlow.ts',
    routerPath: 'oauthDeviceFlow',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/plugin.ts',
    routerPath: 'plugin',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/project.ts',
    routerPath: 'project',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/projectWorkingDirectory.ts',
    routerPath: 'projectWorkingDirectory',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/ragEval.ts',
    routerPath: 'ragEval',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/recent.ts',
    routerPath: 'recent',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/resourcePermission.ts',
    routerPath: 'resourcePermission',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/resourceTransferRequest.ts',
    routerPath: 'resourceTransferRequest',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/sandboxStorage/procedures.ts',
    routerPath: 'sandboxStorage',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/scm.ts',
    routerPath: 'scm',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/search.ts',
    routerPath: 'search',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/sessionGroup.ts',
    routerPath: 'sessionGroup',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/session.ts',
    routerPath: 'session',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/taskLabel.ts',
    routerPath: 'taskLabel',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/task/procedures.ts',
    routerPath: 'task',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/thread.ts',
    routerPath: 'thread',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/topicComment.ts',
    routerPath: 'topicComment',
    uses: ['wsProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/topic/procedures.ts',
    routerPath: 'topic',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/trash.ts',
    routerPath: 'trash',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/tts.ts',
    routerPath: 'tts',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/upload.ts',
    routerPath: 'upload',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/usage.ts',
    routerPath: 'usage',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/userMemory.ts',
    routerPath: 'userMemory',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/userSkill.ts',
    routerPath: 'userSkill',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/verify/procedures.ts',
    routerPath: 'verify',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/video/index.ts',
    routerPath: 'video',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/webBrowsing.ts',
    routerPath: 'webBrowsing',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/widget.ts',
    routerPath: 'widget',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/workspaceUserSettings.ts',
    routerPath: 'workspaceUserSettings',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/lambda/work.ts',
    routerPath: 'work',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/tools/composio.ts',
    routerPath: 'tools',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/tools/market.ts',
    routerPath: 'tools',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'apps/server/src/routers/tools/mcp.ts',
    routerPath: 'tools',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'selfhosted/server/routers/workspaceAuditLog.ts',
    routerPath: 'workspaceAuditLog',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'packages/business-server/src/lambda-routers/workspaceUsage.ts',
    routerPath: 'workspaceUsage',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'selfhosted/server/routers/agentAvailability.ts',
    routerPath: 'agentAvailability',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'selfhosted/server/routers/agentQuota.ts',
    routerPath: 'agentQuota',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'selfhosted/server/routers/workspaceMember.ts',
    routerPath: 'workspaceMember',
    uses: ['wsCompatProcedure'],
  },
  {
    file: 'selfhosted/server/routers/workspaceTeam.ts',
    routerPath: 'workspaceTeam',
    uses: ['wsMemberProcedure'],
  },
  {
    file: 'selfhosted/server/routers/workspace.ts',
    routerPath: 'workspace',
    uses: ['wsProcedure', 'wsCompatProcedure'],
  },
];
