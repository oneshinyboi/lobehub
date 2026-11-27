import { describe, expect, it } from 'vitest';

import { SELFHOSTED_ALIAS_PING } from '@/selfhosted/ping';

describe('@/selfhosted alias', () => {
  it('resolves the overlay through the tsconfig path alias', () => {
    // Without `"@/selfhosted/*": ["./selfhosted/*"]` this import fails to
    // resolve and the test errors before reaching the assertion.
    expect(SELFHOSTED_ALIAS_PING.overlay).toBe('selfhosted');
    expect(SELFHOSTED_ALIAS_PING.alias).toBe('@/selfhosted/ping');
  });

  it('does not fall through to the generic @/* (src) mapping', () => {
    expect(SELFHOSTED_ALIAS_PING).toMatchObject({ overlay: 'selfhosted' });
  });
});
