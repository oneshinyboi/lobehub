import { describe, expect, it } from 'vitest';

import {
  buildCredentialsWriteCommand,
  credentialFilePath,
  maskCredentialEnv,
  maskCredentialValue,
} from '@/server/services/sandbox/credentials';

const base64 = (value: string) => Buffer.from(value).toString('base64');

describe('maskCredentialValue', () => {
  it('keeps the first and last two characters and masks the middle', () => {
    expect(maskCredentialValue('sk-super-secret')).toBe('sk******et');
  });

  it('fully masks values short enough that any preview would leak them', () => {
    expect(maskCredentialValue('abc')).toBe('****');
    expect(maskCredentialValue('abcd')).toBe('****');
  });

  it('returns an empty string for an empty value', () => {
    expect(maskCredentialValue('')).toBe('');
  });
});

describe('maskCredentialEnv', () => {
  it('masks every environment value', () => {
    expect(maskCredentialEnv({ DC_CLI_TOKEN: 'sk-super-secret', SHORT: 'abc' })).toEqual({
      DC_CLI_TOKEN: 'sk******et',
      SHORT: '****',
    });
  });
});

describe('credentialFilePath', () => {
  it('sanitizes the key and filename and uses the documented directory', () => {
    expect(credentialFilePath('my key', 'a b/c.txt')).toBe('~/.creds/files/my-key/a-b-c.txt');
  });
});

describe('buildCredentialsWriteCommand', () => {
  it('writes real exports to session_env and a masked listing to env', () => {
    const command = buildCredentialsWriteCommand({
      env: { DC_CLI_TOKEN: 'sk-super-secret', SHORT: 'abc' },
    });

    const realFile = base64(`export DC_CLI_TOKEN='sk-super-secret'\nexport SHORT='abc'\n`);
    const maskedFile = base64(`# DC_CLI_TOKEN=sk******et\n# SHORT=****\n`);

    expect(command).toBe(
      [
        'mkdir -p ~/.creds',
        'chmod 700 ~/.creds',
        `printf '%s' '${realFile}' | base64 -d > ~/.creds/session_env`,
        'chmod 600 ~/.creds/session_env',
        `printf '%s' '${maskedFile}' | base64 -d > ~/.creds/env`,
        'chmod 600 ~/.creds/env',
      ].join(' && '),
    );
  });

  it('encodes env bodies so a value carrying quotes cannot reach the shell', () => {
    const command = buildCredentialsWriteCommand({ env: { TOKEN: "it's secret" } });

    expect(command).toContain(base64(`export TOKEN='it'\\''s secret'\n`));
    expect(command).not.toContain('secret');
  });

  it('writes file creds by base64 and exports their path env var unquoted so `~` expands', () => {
    const command = buildCredentialsWriteCommand({
      files: [
        { contentBase64: base64('hello'), envName: 'K_PATH', path: '~/.creds/files/k/f.txt' },
      ],
    });

    expect(command).toContain(
      `printf '%s' '${base64('hello')}' | base64 -d > ~/.creds/files/k/f.txt`,
    );
    expect(command).toContain('chmod 600 ~/.creds/files/k/f.txt');
    // Unquoted `~` (tilde-expanded by the shell when session_env is sourced).
    expect(command).toContain(
      `'${base64(`export K_PATH=~/.creds/files/k/f.txt\n`)}' | base64 -d > ~/.creds/session_env`,
    );
    expect(command).toContain(base64(`# FILE ~/.creds/files/k/f.txt\n`));
  });

  it('produces nothing when there is nothing to inject', () => {
    expect(buildCredentialsWriteCommand({})).toBe('');
  });
});
