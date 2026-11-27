/**
 * WS-0 canary source for the self-hosted overlay.
 *
 * `selfhosted/ping.ts` re-exports this through `@/selfhosted/server/ping`, and
 * `selfhosted/ping.test.ts` imports that public entry through
 * `@/selfhosted/ping`. That pair is what proves the alias resolves in both the
 * type-check program and vitest. Real workspace server code replaces the
 * `.gitkeep` in this directory as WS-1..WS-15 land.
 */
export const SELFHOSTED_ALIAS_PING = {
  /** The specifier the test imports — must resolve to the public entry. */
  alias: '@/selfhosted/ping',
  /** Top-level directory of the overlay. */
  overlay: 'selfhosted',
} as const;

export type SelfhostedAliasPing = typeof SELFHOSTED_ALIAS_PING;
