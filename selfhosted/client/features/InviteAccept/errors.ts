/**
 * Stable, machine-readable reasons an invitation cannot be accepted.
 *
 * The server throws one of these as the tRPC error message and the client maps
 * it to copy, so the two sides never drift on a hand-written sentence. They are
 * deliberately opaque: an invitation error must never name or describe the
 * workspace, because the token holder may not be a member yet.
 */
export const INVITATION_ERROR = {
  /** The token expired before anyone accepted it. */
  EXPIRED: 'INVITATION_EXPIRED',
  /** No invitation carries this token. */
  NOT_FOUND: 'INVITATION_NOT_FOUND',
  /** An owner or admin revoked the link. */
  REVOKED: 'INVITATION_REVOKED',
  /** A single-use invitation was already consumed by someone else. */
  USED: 'INVITATION_USED',
  /** The invitation is addressed to a different account. */
  WRONG_ACCOUNT: 'INVITATION_WRONG_ACCOUNT',
} as const;

export type InvitationErrorCode = (typeof INVITATION_ERROR)[keyof typeof INVITATION_ERROR];

const INVITATION_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(INVITATION_ERROR));

export const isInvitationErrorCode = (value: unknown): value is InvitationErrorCode =>
  typeof value === 'string' && INVITATION_ERROR_CODES.has(value);
