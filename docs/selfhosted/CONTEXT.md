# Self-hosted workspace collaboration — working context

Read this before starting any task in the `WS-*` series. It is the shared brief for
implementation **and** review agents. If a task instruction and this document
disagree, stop and comment on the task rather than guessing.

## Goal

Diamond self-hosts LobeHub at `chat.veryshiny.net`. Upstream ships workspace and
collaboration features only in the cloud build: the **data layer and the API
contract are already in the OSS repo**, but the server logic, client hooks and
settings pages are stubs. We are filling those stubs so several people can share
one instance — a workspace with members, teams, invitations and content shared
between them.

The constraint that shapes every decision: **this fork must stay cheap to rebase
onto upstream.** Upstream edits these same files continuously, so we implement
behind the existing seam and touch upstream files as little as possible.

## Non-goals

Do not build, restore or enable: billing, credits, plans, subscriptions, spend,
top-up, referral, storage overage, workspace API keys, contacts / address book /
Channels DMs. Their stubs stay stubs. The OSS defaults for these are already
permissive (no limits), which is what we want.

## Where the seam is

| Path | What it is | State |
| --- | --- | --- |
| `packages/business-server/src/lambda-routers/*` | Cloud routers, present as typed stubs. The input schemas are already declared — treat them as the contract. | `NOT_IMPLEMENTED` or empty results |
| `packages/business-server/src/trpc-middlewares/workspaceAuth.ts` | `cloudWorkspaceAuth`, `requireWorkspaceRole*`, `ws*Procedure` | no-ops / missing role checks |
| `packages/business-server/src/trpc-middlewares/rbacPermission.ts` | `withRbacPermission` and friends | always passes |
| `src/business/client/**` | Client hooks, settings pages, header injection | `[]`, `null`, `{}` |
| `packages/business/const/src/index.ts` | `ENABLE_BUSINESS_FEATURES = false` — a **build-time** constant, 24 consumers | off |
| `apps/server/src/routers/lambda/index.ts` | Mounts every router at `/trpc/lambda`; there is no separate service | real |
| `packages/trpc/src/lambda/context.ts` | Sets `ctx.workspaceId` from the `X-Workspace-Id` header | real, **unvalidated** |
| `packages/database/src/utils/workspace.ts` | `buildWorkspaceWhere` / `buildWorkspacePayload`; ~127 models already use them | real |
| `packages/database/src/models/{workspace,workspaceMember,workspaceTeam,rbac,resourcePermission,workspaceAuditLog,workspaceUserSettings}.ts` | Data layer | real and complete |
| `src/spa/router/workspaceSettingsRoutes.tsx`, `src/routes/(main)/[workspaceSlug]/*` | Routing, URL sync, settings tabs | real, page bodies stubbed |

Upstream's own override mechanism is `.github/actions/business-overlay`: the cloud
build copies a private overlay repo over the checkout. We use the same idea in a
lighter form — code under `selfhosted/`, one-line re-exports in upstream files.

## Invariants

- **I1 — No schema work.** The database is done. No edits under
  `packages/database/src/schemas`, no new migrations, no `drizzle-kit generate`.
- **I2 — New code lives under `selfhosted/`.** An upstream file may only gain a
  one-line re-export (`export * from '@/selfhosted/...'`). Anything longer needs
  a justification in `docs/selfhosted/SELFHOSTED.md`.
- **I3 — Never trust `ctx.workspaceId` alone.** The tRPC context copies it from a
  request header without checking membership. Every path that reads or writes
  workspace-scoped data must go through `cloudWorkspaceAuth` or an equivalent
  membership check first. This is a security invariant, not a style rule.
- **I4 — Personal mode is unchanged.** No `X-Workspace-Id` header means the caller
  behaves exactly as before this work. Do not make personal requests require a
  workspace.
- **I5 — No new npm dependencies.** Use what the repo already has (zustand, SWR,
  `@tanstack/react-query`, zod, trpc, `@lobehub/ui`).
- **I6 — Tests that fail without the change.** A test asserting `200 OK` on the
  happy path is not enough; assert the failure mode the task exists to prevent.
- **I7 — Stay in scope.** Only edit the files listed in the task. If the work
  genuinely needs another file, stop and comment on the task.
- **I8 — Do not change `ENABLE_BUSINESS_FEATURES`.** It gates 24 unrelated
  consumers including sandbox-storage payments. Feature-scoped constants only.

## Decisions already made

- **D1 — Invitations are link-only.** No SMTP, no email delivery. `SMTP_*` stays
  unset. An invite is a tokenised URL the owner copies and sends themselves.
- **D2 — Workspace content is visible to all members by default.**
  `agents.visibility` defaults to `'public'`; per-resource private rows stay
  creator-only via `buildWorkspaceWhere`. Do not add a stricter default.
- **D3 — Scope is phases 0–2.** Foundation, people, then teams/audit/permissions.
  Contacts, Channels and DMs are out of scope.
- **D4 — Roles are `viewer < member < admin < owner`**, stored in
  `workspace_members.role`. That column is the single source of truth for
  built-in roles — do not seed or depend on `rbac_*` rows.

## Code layout

```
selfhosted/
  server/            # workspaceAuth, routers, helpers
  client/            # hooks, stores, settings pages
  __tests__/         # cross-cutting scope-isolation suite
```

Alias: `@/selfhosted/*` → `./selfhosted/*` (added by WS-0).

## Commands

```bash
pnpm type-check                 # tsrs, what CI runs
pnpm vitest run <path>          # single file / directory
pnpm lint:ts                    # oxlint
pnpm dev                        # local app on :3010
```

`pnpm type-check` is the gate that matters most: a re-export whose signature
upstream changed must fail here rather than silently drift at runtime.

## Worktree protocol

One task = one worktree = one branch. Repo root is
`/home/diamond/Projects/AI/lobehub`.

```bash
git worktree add ../lobehub.wt/<task-id> -b feat/<task-id>-<slug> feat/workspace-phase-<N>
git -C ../lobehub.wt/<task-id> pnpm install --frozen-lockfile
```

- Branch from the **phase integration branch**, never from `downstream-main`.
- Merge back into the phase integration branch, not into `downstream-main`.
- Maximum **3** concurrent worktrees — each needs its own `node_modules`.
- Target branch, worktree path and file scope are given in every task.

## Task series

WS-0 scaffolding · WS-1 auth · WS-2 workspace router · WS-3 client store ·
WS-4 header injection · WS-5 switcher · WS-6 isolation suite · WS-7 invitations ·
WS-8 acceptance · WS-9 members page · WS-10 member identity · WS-11 teams router ·
WS-12 teams page · WS-13 audit log · WS-14 permissions · WS-15 share flag.

Review tasks RV-0 / RV-1 / RV-2 gate each phase; read `REVIEW.md` before reviewing.
