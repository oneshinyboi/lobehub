/**
 * Credential handling shared by the sandbox providers that write credentials
 * into their own sandbox.
 *
 * Only the Onlyboxes provider uses this today: the Market sandbox injects
 * credentials upstream, so its provider never builds a write command.
 */

import type { SandboxCredentialFile } from './types';

/** Path holding the real `export` lines, sourced before every command. */
export const SANDBOX_CREDS_ENV_FILE = '~/.creds/session_env';
/** Reference-only listing of injected keys, masked, for the model to read. */
export const SANDBOX_CREDS_REFERENCE_FILE = '~/.creds/env';
/** Directory file credentials are extracted to. */
export const SANDBOX_CREDS_FILES_DIR = '~/.creds/files';

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const base64 = (value: string) => Buffer.from(value).toString('base64');
const PATH_SEGMENT_UNSAFE = /[^\w.-]/g;
const ENV_NAME_UNSAFE = /\W/g;

/**
 * Where a file credential is extracted. The key and filename are reduced to a
 * safe charset so the path can be used unquoted in the shell (and still lets
 * `~` expand when the env var is sourced).
 */
export const credentialFilePath = (key: string, fileName: string): string =>
  `${SANDBOX_CREDS_FILES_DIR}/${key.replaceAll(PATH_SEGMENT_UNSAFE, '-')}/${fileName.replaceAll(PATH_SEGMENT_UNSAFE, '-')}`;

/**
 * Preview shown to the model and written to the reference file. Keeps the first
 * and last two characters so the model can identify a credential without being
 * able to reconstruct it; anything short enough that a preview would leak the
 * whole value is masked entirely.
 */
export const maskCredentialValue = (value: string): string => {
  if (!value) return '';
  return value.length <= 4 ? '****' : `${value.slice(0, 2)}******${value.slice(-2)}`;
};

export const maskCredentialEnv = (env: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).map(([key, value]) => [key, maskCredentialValue(value)]));

/**
 * Builds the shell command that lands credentials in the sandbox:
 *
 * - {@link SANDBOX_CREDS_ENV_FILE} gets the real `export` lines, which the
 *   provider sources before every command. Values are base64-transported, so a
 *   secret containing quotes or newlines cannot break out of the shell.
 * - {@link SANDBOX_CREDS_REFERENCE_FILE} gets a masked comment listing (env
 *   values masked, file paths verbatim) matching what the system prompt
 *   describes, so it is safe to hand to the model.
 * - File credentials are decoded into {@link SANDBOX_CREDS_FILES_DIR}, and — if
 *   they declare one — their path is exported. That line is emitted unquoted so
 *   the shell tilde-expands it when session_env is sourced.
 *
 * Returns an empty string when there is nothing to write.
 */
export const buildCredentialsWriteCommand = ({
  env = {},
  files = [],
}: {
  env?: Record<string, string>;
  files?: SandboxCredentialFile[];
}): string => {
  const envEntries = Object.entries(env).filter(([key]) => key);
  if (envEntries.length === 0 && files.length === 0) return '';

  const realLines = envEntries.map(([key, value]) => `export ${key}=${shellQuote(value)}`);
  const pathLines = files
    .filter((file) => file.envName)
    .map((file) => `export ${file.envName!.replaceAll(ENV_NAME_UNSAFE, '_')}=${file.path}`);

  const referenceLines = [
    ...envEntries.map(([key, value]) => `# ${key}=${maskCredentialValue(value)}`),
    ...files.map((file) => `# FILE ${file.path}`),
  ];

  const steps: string[] = ['mkdir -p ~/.creds', 'chmod 700 ~/.creds'];

  const sessionLines = [...realLines, ...pathLines];
  if (sessionLines.length > 0) {
    const content = `${sessionLines.join('\n')}\n`;
    steps.push(
      `printf '%s' '${base64(content)}' | base64 -d > ${SANDBOX_CREDS_ENV_FILE}`,
      `chmod 600 ${SANDBOX_CREDS_ENV_FILE}`,
    );
  }

  const referenceContent = `${referenceLines.join('\n')}\n`;
  steps.push(
    `printf '%s' '${base64(referenceContent)}' | base64 -d > ${SANDBOX_CREDS_REFERENCE_FILE}`,
    `chmod 600 ${SANDBOX_CREDS_REFERENCE_FILE}`,
  );

  for (const file of files) {
    const dir = file.path.slice(0, file.path.lastIndexOf('/'));
    steps.push(
      `mkdir -p ${dir}`,
      `printf '%s' '${file.contentBase64}' | base64 -d > ${file.path}`,
      `chmod 600 ${file.path}`,
    );
  }

  return steps.join(' && ');
};
