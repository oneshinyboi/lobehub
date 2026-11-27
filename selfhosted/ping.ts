/**
 * Public entry of the WS-0 canary.
 *
 * This file is part of the type-check program (`selfhosted/**` is in
 * `include`), and it reaches the implementation through `@/selfhosted/*`, so
 * `pnpm type-check` proves the alias resolves even though test files are
 * excluded from `tsconfig.type-check.json`. `ping.test.ts` proves the same
 * thing at runtime under vitest.
 */
export type { SelfhostedAliasPing } from '@/selfhosted/server/ping';
export { SELFHOSTED_ALIAS_PING } from '@/selfhosted/server/ping';
