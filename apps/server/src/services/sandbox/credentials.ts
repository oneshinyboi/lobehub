/**
 * Credential handling shared by the sandbox providers that write credentials
 * into their own sandbox.
 *
 * Only the Onlyboxes provider uses this today: the Market sandbox injects
 * credentials upstream, so its provider never builds a write command.
 */

/** Path holding the real `export` lines, sourced before every command. */
export const SANDBOX_CREDS_ENV_FILE = '~/.creds/session_env';
/** Reference-only listing of injected keys, masked, for the model to read. */
export const SANDBOX_CREDS_REFERENCE_FILE = '~/.creds/env';

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

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

/** Base64 so the file body never meets the shell, whatever a value contains. */
const writeFileCommand = (path: string, content: string) =>
  `printf '%s' '${Buffer.from(content).toString('base64')}' | base64 -d > ${path} && chmod 600 ${path}`;

/**
 * Builds the shell command that lands credentials in the sandbox:
 *
 * - {@link SANDBOX_CREDS_ENV_FILE} gets the real `export` lines, which the
 *   provider sources before every command.
 * - {@link SANDBOX_CREDS_REFERENCE_FILE} gets a masked comment listing matching
 *   what the system prompt describes, so it is safe to hand to the model.
 *
 * Each file body is base64-encoded and decoded in the sandbox, so a credential
 * value carrying quotes, newlines or `;` cannot break out into the surrounding
 * shell — and the real file's own `export KEY='…'` quoting survives intact.
 * Returns an empty string when there is nothing to write.
 */
export const buildCredentialsWriteCommand = (env: Record<string, string>): string => {
  const entries = Object.entries(env).filter(([key]) => key);
  if (entries.length === 0) return '';

  const realContent = entries
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n');
  const maskedContent = entries
    .map(([key, value]) => `# ${key}=${maskCredentialValue(value)}`)
    .join('\n');

  return [
    'mkdir -p ~/.creds',
    'chmod 700 ~/.creds',
    writeFileCommand(SANDBOX_CREDS_ENV_FILE, `${realContent}\n`),
    writeFileCommand(SANDBOX_CREDS_REFERENCE_FILE, `${maskedContent}\n`),
  ].join(' && ');
};
