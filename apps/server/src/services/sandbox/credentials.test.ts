import { describe, expect, it } from 'vitest';

import {
  buildCredentialsWriteCommand,
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

describe('buildCredentialsWriteCommand', () => {
  it('writes real exports to session_env and a masked listing to env', () => {
    const command = buildCredentialsWriteCommand({
      DC_CLI_TOKEN: 'sk-super-secret',
      SHORT: 'abc',
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

  it('encodes the file body so a value carrying quotes cannot reach the shell', () => {
    const command = buildCredentialsWriteCommand({ TOKEN: "it's secret" });

    // The real file line survives single-quote escaping within the base64 body.
    expect(command).toContain(base64(`export TOKEN='it'\\''s secret'\n`));
    // The value itself never appears raw in the command.
    expect(command).not.toContain('secret');
  });

  it('produces nothing when there is nothing to inject', () => {
    expect(buildCredentialsWriteCommand({})).toBe('');
  });
});
