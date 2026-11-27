# Merge review — checklist

You are reviewing one task branch of the self-hosted workspace work. The question
is not whether the code is pleasant; it is whether this can enter the integration
branch **without raising the cost of the next upstream rebase**, and without
breaking a security invariant.

Read `docs/selfhosted/CONTEXT.md` first, then apply every check below.

## Checks

| ID  | Check                                                                                                                                                                                                                                                                                                                                                                                                                                       | How to verify                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| R1  | **Scope** — the diff touches only files listed in the task.                                                                                                                                                                                                                                                                                                                                                                                 | `git diff --stat <base>...HEAD`                       |
| R2  | **Seam** — new logic lives under `selfhosted/`; each upstream file changed gained at most a one-line re-export. **Exception:** a `src/business/client/**` shim may hold a small dependency-free adapter (reading existing hooks, shaping a header or props) when the alternative is to hide that glue in a file nobody will find. The test is "no business logic beyond reading existing hooks and shaping the response", not a line count. | Read the diff, not the summary                        |
| R3  | **No schema drift** — nothing under `packages/database/src/schemas`, no new migration, no `drizzle-kit generate`.                                                                                                                                                                                                                                                                                                                           | `git diff --name-only`                                |
| R4  | **No new dependencies** — `package.json` / `pnpm-lock.yaml` unchanged.                                                                                                                                                                                                                                                                                                                                                                      | same                                                  |
| R5  | **Tests assert the failure mode.** At least one test fails if the change is reverted.                                                                                                                                                                                                                                                                                                                                                       | Delete the change mentally and re-read the assertions |
| R6  | **Security (I3)** — no path reads or writes workspace data on `ctx.workspaceId` alone; a foreign workspace id must be refused.                                                                                                                                                                                                                                                                                                              | Trace the procedure → middleware → model              |
| R7  | **Build green** — `pnpm type-check` and the task's test files pass.                                                                                                                                                                                                                                                                                                                                                                         | Run them                                              |
| R8  | **Non-goals respected** — nothing from CONTEXT.md §Non-goals appears.                                                                                                                                                                                                                                                                                                                                                                       | grep the diff                                         |
| R9  | **No escape hatches** — no `any`, no `.skip`/`.only`, no commented-out assertions, no `eslint-disable` added.                                                                                                                                                                                                                                                                                                                               | grep the diff                                         |
| R10 | **Rebase cost declared** — every upstream file touched is listed in `docs/selfhosted/SELFHOSTED.md`.                                                                                                                                                                                                                                                                                                                                        | Diff the inventory                                    |

## Verdict

Output exactly this shape:

```
VERDICT: APPROVE | REQUEST CHANGES | REJECT

CHECKS: R1 pass | R2 pass | ... (one line each, with evidence)

BLOCKERS:            (empty on APPROVE)
- <file>:<line> — <what is wrong> — <what would fix it>

NOTES:               (non-blocking observations, max 5 lines)
```

Every blocker cites `file:line`. "Consider refactoring" is not a blocker;
"`selfhosted/server/workspaceAuth.ts:42` sets `ctx.workspaceId` before the
membership query, so a non-member passes" is.

## You must not

- edit code, push commits, or open pull requests;
- fix anything yourself — file the fix as a new task instead;
- approve on the strength of the author's own summary;
- approve a diff you could not run `pnpm type-check` against.

If the branch does not build, the verdict is REJECT regardless of design quality.
