/**
 * Stable, machine-readable refusals for workspace member management.
 *
 * The server throws one of these as the tRPC error message and the settings
 * page maps it to copy, so the two sides never drift on a hand-written
 * sentence. The last-owner refusal is deliberately explicit: the client must
 * not guess it, because only the server sees the whole roster at write time.
 */
export const WORKSPACE_MEMBER_ERROR = {
  /** Demoting or removing this member would leave the workspace without an owner. */
  LAST_OWNER: 'WORKSPACE_LAST_OWNER',
  /** No active membership for the requested user. */
  MEMBER_NOT_FOUND: 'WORKSPACE_MEMBER_NOT_FOUND',
} as const;

export type WorkspaceMemberErrorCode =
  (typeof WORKSPACE_MEMBER_ERROR)[keyof typeof WORKSPACE_MEMBER_ERROR];

const WORKSPACE_MEMBER_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(WORKSPACE_MEMBER_ERROR),
);

export const isWorkspaceMemberErrorCode = (value: unknown): value is WorkspaceMemberErrorCode =>
  typeof value === 'string' && WORKSPACE_MEMBER_ERROR_CODES.has(value);
