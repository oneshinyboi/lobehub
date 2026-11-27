# Upstream files touched by the self-hosted build

Generated from `git diff --name-only fb729deeb5..HEAD` (full tree, no path
restriction), not from memory. The earlier `-- src packages apps` path scope
silently dropped `tsconfig.json` at the repo root; that scope is gone. **40 files.** If a
merge conflicts in a file that is not listed here, the work went out of scope —
or this file is stale. Regenerate it before continuing rather than editing by hand.

`Shape` is what the change looks like in a diff, which is what determines rebase
cost. `re-export` means the file carries no logic of ours and a conflict resolves
by taking upstream's version and re-adding one line.

| File                                                                            | Shape                                                                                                                          | Task      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `apps/server/src/routers/lambda/__tests__/agentQuota.accountVisibility.test.ts` | \~13 lines                                                                                                                     | WS-19     |
| `apps/server/src/routers/lambda/__tests__/agentQuota.ingestSnapshot.test.ts`    | \~13 lines                                                                                                                     | WS-19     |
| `tsconfig.json`                                                                 | alias + include — `@/selfhosted/*` mapping and the `selfhosted/**` include that puts the overlay inside the type-check program | WS-0      |
| `apps/server/src/routers/lambda/agentAvailability.ts`                           | re-export                                                                                                                      | WS-17     |
| `apps/server/src/routers/lambda/agentQuota.ts`                                  | re-export                                                                                                                      | WS-19     |
| `packages/business-server/src/lambda-routers/workspace.ts`                      | re-export                                                                                                                      | WS-2      |
| `packages/business-server/src/lambda-routers/workspaceAuditLog.ts`              | re-export                                                                                                                      | WS-13/18  |
| `packages/business-server/src/lambda-routers/workspaceMember.ts`                | re-export                                                                                                                      | WS-7/8/10 |
| `packages/business-server/src/lambda-routers/workspaceTeam.ts`                  | re-export                                                                                                                      | WS-11     |
| `packages/business-server/src/trpc-middlewares/rbacPermission.ts`               | re-export                                                                                                                      | WS-14     |
| `packages/business-server/src/trpc-middlewares/workspaceAuth.test.ts`           | deleted                                                                                                                        | WS-1/1b   |
| `packages/business-server/src/trpc-middlewares/workspaceAuth.ts`                | re-export                                                                                                                      | WS-1/1b   |
| `packages/business/const/src/index.ts`                                          | \~14 lines                                                                                                                     | WS-15     |
| `packages/const/src/apiKeyScope.ts`                                             | \~4 lines                                                                                                                      | WS-11     |
| `src/business/client/BusinessDesktopRoutes.tsx`                                 | \~4 lines                                                                                                                      | WS-8      |
| `src/business/client/BusinessSettingPages/WorkspaceAuditLog.tsx`                | re-export                                                                                                                      | WS-18     |
| `src/business/client/BusinessSettingPages/WorkspaceMembers.tsx`                 | re-export                                                                                                                      | WS-9      |
| `src/business/client/BusinessSettingPages/WorkspaceTeams.tsx`                   | re-export                                                                                                                      | WS-12     |
| `src/business/client/features/User/UserPanelWorkspaceSection.tsx`               | re-export                                                                                                                      | WS-5      |
| `src/business/client/hooks/useActiveWorkspace.ts`                               | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useActiveWorkspaceId.ts`                             | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useActiveWorkspaceSlug.ts`                           | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useFetchWorkspaceMembers.ts`                         | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useHasActiveWorkspace.ts`                            | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useHasWorkspace.ts`                                  | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useIsWorkspaceLoading.ts`                            | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useIsWorkspaceOwner.ts`                              | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useIsWorkspaceViewer.ts`                             | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useSwitchWorkspace.ts`                               | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useWorkspaceMemberProfiles.ts`                       | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useWorkspaceMembers.ts`                              | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/hooks/useWorkspaces.ts`                                    | re-export                                                                                                                      | WS-3/10   |
| `src/business/client/trpc-headers.ts`                                           | \~21 lines                                                                                                                     | WS-4      |
| `src/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index.tsx`             | \~2 lines                                                                                                                      | WS-15     |
| `src/features/SharePopover/shareFlag.test.ts`                                   | \~51 lines                                                                                                                     | WS-15     |
| `src/hooks/usePermission.ts`                                                    | re-export                                                                                                                      | WS-14     |
| `src/routes/(main)/agent/features/Conversation/Header/HeaderActions/index.tsx`  | \~2 lines                                                                                                                      | WS-15     |
| `src/routes/(main)/agent/features/Conversation/Header/ShareButton/index.tsx`    | \~2 lines                                                                                                                      | WS-15     |
| `src/routes/(main)/group/features/Conversation/Header/ShareButton/index.tsx`    | \~2 lines                                                                                                                      | WS-15     |
| `src/routes/(main)/invite/[token]/index.tsx`                                    | re-export                                                                                                                      | WS-8      |

## Rebase runbook

1. **Pin** to a release tag, not `main` tip. `main` is already an ancestor of the
   integration branch, so upstream merges are deliberate rather than accidental.
2. **Merge upstream into the integration branch** between tasks, never mid-task.
3. Conflict in a listed `re-export` file → take upstream's version, re-add the one
   line, run `pnpm type-check`. Expected cost: minutes.
4. Conflict in an **unlisted** file → stop. Either the work drifted out of scope,
   or this inventory is stale. Regenerate it before continuing.
5. `pnpm type-check` is the merge acceptance test: a re-export whose signature
   changed upstream fails there, not in production.
6. Re-run `pnpm vitest run selfhosted` after every merge. The WS-6 matrix invokes
   every procedure carrying `cloudWorkspaceAuth` by function identity, so a
   middleware that silently stops composing is caught by the suite, not by a user.

## Note on scope

`WorkspaceGeneral` and `WorkspaceNotification` settings shims still return `null`
upstream. No selfhosted implementation exists for either, so that is new feature
work outside phases 0–2, not a missing re-export. Deliberately not built.
