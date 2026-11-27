/**
 * Roles the members page may assign. `owner` is deliberately absent: ownership
 * moves only through the dedicated transfer flow, never through this page.
 */
export const ASSIGNABLE_ROLES = ['viewer', 'member', 'admin'] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export type MemberRole = AssignableRole | 'owner';

export const isAssignableRole = (value: unknown): value is AssignableRole =>
  ASSIGNABLE_ROLES.includes(value as AssignableRole);

/** Roles a member row can currently hold, in the product's low-to-high order. */
export const MEMBER_ROLE_ORDER: readonly MemberRole[] = ['viewer', 'member', 'admin', 'owner'];

export const isMemberRole = (value: null | string | undefined): value is MemberRole =>
  MEMBER_ROLE_ORDER.includes(value as MemberRole);
