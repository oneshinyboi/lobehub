# Upstream files touched by the self-hosted build

One row per upstream file modified on `feat/workspace-phase-0`, verified against
`git diff fb729deeb5..HEAD` rather than written from memory. If a merge conflicts
in a file that is **not** listed here, the work went out of scope — or this file
is stale. Fix it before continuing.

`Shape` is what the change looks like in a diff, which is what determines rebase
cost. `re-export` means the file carries no logic of ours and a conflict resolves
by taking upstream's version and re-adding one line.

| File                                                                           | Shape                                                                                                                                  | Task                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `tsconfig.json`                                                                | alias + include                                                                                                                        | WS-0                |
| `packages/business-server/src/trpc-middlewares/workspaceAuth.ts`               | re-export                                                                                                                              | WS-1 / WS-1b        |
| `packages/business-server/src/trpc-middlewares/rbacPermission.ts`              | re-export                                                                                                                              | WS-14               |
| `packages/business-server/src/trpc-middlewares/workspaceAuth.test.ts`          | **deleted** — asserted the vulnerable no-op and was excluded from the default vitest glob, so it documented the hole without running   | WS-6                |
| `packages/business-server/src/lambda-routers/workspace.ts`                     | re-export                                                                                                                              | WS-2                |
| `packages/business-server/src/lambda-routers/workspaceMember.ts`               | re-export                                                                                                                              | WS-7 / WS-8 / WS-10 |
| `packages/business-server/src/lambda-routers/workspaceTeam.ts`                 | re-export                                                                                                                              | WS-11               |
| `packages/business-server/src/lambda-routers/workspaceAuditLog.ts`             | re-export                                                                                                                              | WS-13               |
| `packages/business/const/src/index.ts`                                         | +14 lines — new `ENABLE_TOPIC_LINK_SHARE` export only; `ENABLE_BUSINESS_FEATURES` untouched (I8)                                       | WS-15               |
| `src/business/client/BusinessDesktopRoutes.tsx`                                | \~4 lines — re-exports invite-accept routes through the business-route seam                                                            | WS-8                |
| `src/business/client/BusinessSettingPages/WorkspaceMembers.tsx`                | re-export                                                                                                                              | WS-9                |
| `src/business/client/BusinessSettingPages/WorkspaceTeams.tsx`                  | re-export                                                                                                                              | WS-12               |
| `src/business/client/BusinessSettingPages/WorkspaceAuditLog.tsx`               | re-export — shim was `return null` until WS-18 wired it to the real page                                                               | WS-18               |
| `src/business/client/features/User/UserPanelWorkspaceSection.tsx`              | re-export                                                                                                                              | WS-5                |
| `src/business/client/trpc-headers.ts`                                          | \~21 lines — thin adapter reading `getActiveWorkspaceId()` and shaping the header; allowed by REVIEW.md R2's business-client exception | WS-4                |
| `src/business/client/hooks/useWorkspaces.ts`                                   | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useActiveWorkspace.ts`                              | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useActiveWorkspaceId.ts`                            | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useActiveWorkspaceSlug.ts`                          | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useSwitchWorkspace.ts`                              | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useHasWorkspace.ts`                                 | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useHasActiveWorkspace.ts`                           | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useIsWorkspaceLoading.ts`                           | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useIsWorkspaceOwner.ts`                             | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useIsWorkspaceViewer.ts`                            | re-export                                                                                                                              | WS-3                |
| `src/business/client/hooks/useWorkspaceMembers.ts`                             | re-export                                                                                                                              | WS-10               |
| `src/business/client/hooks/useFetchWorkspaceMembers.ts`                        | re-export                                                                                                                              | WS-10               |
| `src/business/client/hooks/useWorkspaceMemberProfiles.ts`                      | re-export                                                                                                                              | WS-10               |
| `src/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index.tsx`            | \~2 lines — reads the share constant                                                                                                   | WS-15               |
| `src/features/SharePopover/shareFlag.test.ts`                                  | new file — asserts all four consumers read the constant                                                                                | WS-15               |
| `src/hooks/usePermission.ts`                                                   | re-export                                                                                                                              | WS-14               |
| `src/routes/(main)/agent/features/Conversation/Header/HeaderActions/index.tsx` | \~2 lines — the site the fork had missed                                                                                               | WS-15               |
| `src/routes/(main)/agent/features/Conversation/Header/ShareButton/index.tsx`   | \~2 lines                                                                                                                              | WS-15               |
| `src/routes/(main)/group/features/Conversation/Header/ShareButton/index.tsx`   | \~2 lines                                                                                                                              | WS-15               |
| `src/routes/(main)/invite/[token]/index.tsx`                                   | new file, no upstream edit                                                                                                             | WS-8                |

## Rebase runbook

1. **Pin** to a release tag, not `main` tip. The integration branch is main-synced;
   upstream `main` is already an ancestor, so a merge brings upstream changes in
   deliberately rather than by accident.
2. **Merge upstream into the integration branch** between tasks, never mid-task.
3. Conflict in a listed `re-export` file → take upstream's version, re-add the one
   line, run `pnpm type-check`. Expected cost: minutes.
4. Conflict in an **unlisted** file → stop. Either the work drifted out of scope,
   or this inventory is stale. Fix the inventory before continuing.
5. `pnpm type-check` is the merge acceptance test: a re-export whose signature
   changed upstream fails there, not in production.
6. Re-run `pnpm vitest run selfhosted` after every merge. The WS-6 matrix invokes
   every procedure carrying `cloudWorkspaceAuth` by function identity, so a
   middleware that silently stops composing is caught by the suite, not by a user.
