# `selfhosted/` — overlay for the self-hosted workspace build

This directory holds the code we add on top of upstream LobeHub. Upstream ships
the workspace/collaboration data layer and API contract but leaves the server
logic, client hooks and settings pages as stubs; the implementations live here
instead of in the upstream files, so rebasing onto upstream stays cheap.

Read `docs/selfhosted/CONTEXT.md` first — invariants I1–I8 are binding.

## Layout

```
selfhosted/
  server/            # workspaceAuth, routers, helpers (tRPC/server side)
  client/            # hooks, stores, settings pages (React side)
  __tests__/         # cross-cutting scope-isolation suite (WS-6)
  ping.ts            # WS-0 canary: proves the alias resolves
  ping.test.ts       # imports ping.ts via @/selfhosted/ping
```

- **`server/`** — server-only code: membership/role checks, workspace routers,
  permission mapping. Never imported from the browser bundle. It currently holds
  only the WS-0 canary source (`ping.ts`), which `selfhosted/ping.ts` re-exports
  through the alias.
- **`client/`** — browser code: zustand stores, SWR/react-query hooks, settings
  pages. Consumed by upstream files via one-line re-exports.
- **`__tests__/`** — tests that span more than one module (the WS-6
  scope-isolation suite lives here). Unit tests stay next to their subject, as
  `ping.test.ts` does.
- `client/` and `__tests__/` are intentionally empty until their first real file
  lands, so they are kept in git with a `.gitkeep`. Delete the placeholder with
  the first commit that fills the directory.

## Alias

`@/selfhosted/*` → `./selfhosted/*` is declared in the root `tsconfig.json`.
Put the alias **before** the generic `@/*` mapping so the more specific overlay
path wins.

Every build surface resolves it from that one declaration, so no extra resolver
config was needed:

| Gate                                                   | How it resolves paths                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `pnpm type-check` (`tsgo -p tsconfig.type-check.json`) | `compilerOptions.paths`; `selfhosted/**` is in `include` so the overlay is actually checked |
| `pnpm vitest`                                          | `vite-tsconfig-paths` in `vitest.config.mts`                                                |
| SPA build (`vite build`)                               | `resolve.tsconfigPaths: true` in `vite.config.ts`                                           |
| Next.js build                                          | native `tsconfig` path support                                                              |

Both gates are exercised by `selfhosted/ping.test.ts`:

```bash
export PNPM_HOME=/home/diamond/.local/share/pnpm
pnpm type-check
pnpm vitest run selfhosted/ping.test.ts
```

## Rules of the overlay

1. Upstream files gain **one-line re-exports** only, and every touched file is
   listed in `docs/selfhosted/SELFHOSTED.md`.
2. Do not add dependencies. Use what the repo already has (zustand, SWR,
   `@tanstack/react-query`, zod, tRPC, `@lobehub/ui`).
3. Do not touch the database schema or `ENABLE_BUSINESS_FEATURES`.
