# Upstream files touched by the self-hosted build

One row per upstream file we modify. This is the rebase worklist: if a merge
conflicts in a file that is **not** listed here, something went out of scope.

`Change` is always "one-line re-export" unless stated otherwise.

| Upstream file                                                      | Change                                                                                                        | Task  | Status  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----- | ------- |
| `tsconfig.json`                                                    | add `@/selfhosted/*` alias; add `selfhosted/**` to `include` so `pnpm type-check` actually checks the overlay | WS-0  | done    |
| `packages/business-server/src/trpc-middlewares/workspaceAuth.ts`   | re-export from `selfhosted/server/workspaceAuth`                                                              | WS-1  | planned |
| `packages/business-server/src/lambda-routers/workspace.ts`         | re-export from `selfhosted/server/routers/workspace`                                                          | WS-2  | planned |
| `src/business/client/hooks/useWorkspaces.ts` + 7 sibling hooks     | re-export from `selfhosted/client/hooks`                                                                      | WS-3  | planned |
| `src/business/client/trpc-headers.ts`                              | implement inline (\~10 lines)                                                                                 | WS-4  | planned |
| `src/business/client/features/User/UserPanelWorkspaceSection.tsx`  | re-export settings/switcher entry                                                                             | WS-5  | planned |
| `packages/business-server/src/lambda-routers/workspaceMember.ts`   | re-export                                                                                                     | WS-7  | planned |
| `src/routes/(main)/invite/[token]` (new route)                     | new file, no upstream edit                                                                                    | WS-8  | planned |
| `src/business/client/BusinessDesktopRoutes.tsx`                    | re-export from `selfhosted/client/features/InviteAccept/routes` (registers `/invite/:token`)                  | WS-8  | planned |
| `src/business/client/BusinessSettingPages/WorkspaceMembers.tsx`    | re-export                                                                                                     | WS-9  | planned |
| `src/business/client/hooks/useWorkspaceMembers.ts` and siblings    | re-export                                                                                                     | WS-10 | planned |
| `packages/business-server/src/lambda-routers/workspaceTeam.ts`     | re-export                                                                                                     | WS-11 | planned |
| `src/business/client/BusinessSettingPages/WorkspaceTeams.tsx`      | re-export                                                                                                     | WS-12 | planned |
| `packages/business-server/src/lambda-routers/workspaceAuditLog.ts` | re-export                                                                                                     | WS-13 | planned |
| `src/business/client/BusinessSettingPages/WorkspaceAuditLog.tsx`   | re-export                                                                                                     | WS-13 | planned |
| `src/hooks/usePermission.ts`                                       | re-export from `selfhosted/client/usePermission`                                                              | WS-14 | planned |
| `packages/business/const/src/index.ts`                             | add `ENABLE_TOPIC_LINK_SHARE` (new export only)                                                               | WS-15 | planned |
| 3 share-button call sites + `HeaderActions`                        | read the new constant                                                                                         | WS-15 | planned |

### WS-0 notes

- The alias is `"@/selfhosted/*": ["./selfhosted/*"]`, placed before the generic
  `@/*` mapping. `selfhosted/**/*.ts` and `selfhosted/**/*.tsx` are also added to
  `include`: `tsconfig.type-check.json` narrows `exclude` only, so without this
  the whole overlay would sit outside `pnpm type-check` and WS-1..WS-15 would
  never be type-checked.
- No resolver config was needed in `vitest.config.mts`, `vite.config.ts` or
  `next.config.ts`. They already read `tsconfig` paths (`vite-tsconfig-paths`,
  `resolve.tsconfigPaths: true`, Next's native support), so this row is the only
  upstream edit WS-0 makes.
- Proof: `selfhosted/ping.test.ts` imports `@/selfhosted/ping` for the runtime
  gate; `selfhosted/ping.ts` is in the type-check program and re-exports
  `selfhosted/server/ping` through the same alias, so `pnpm type-check` resolves
  it too. Removing the alias fails both gates.

## Rebase runbook

1. Pin: work from a release tag, not `main` tip. Record the tag here when you merge.
2. Merge upstream into `downstream-main` **before** starting new feature work, never
   mid-task.
3. Conflict in a listed file → take upstream's version, re-apply the one-line
   re-export, run `pnpm type-check`. Expected to be minutes.
4. Conflict in an unlisted file → stop. Either the work drifted out of scope, or
   the inventory is stale. Fix the inventory before continuing.
5. `pnpm type-check` is the acceptance test for a merge: a re-export whose
   signature changed upstream fails there, not in production.
6. Re-run `pnpm vitest run selfhosted` after every merge — the isolation suite in
   WS-6 is what proves the security invariant survived.
