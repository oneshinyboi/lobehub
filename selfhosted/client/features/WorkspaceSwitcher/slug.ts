import {
  isWorkspaceSlugFormatValid,
  WORKSPACE_SLUG_MAX,
  WORKSPACE_SLUG_MIN,
} from '@lobechat/const';

/**
 * Derive the URL slug a workspace created from `name` would get by default.
 *
 * Accents are folded first so "Café" becomes `cafe` rather than a dangling
 * hyphen. Characters that cannot appear in a slug (including every non-Latin
 * script) collapse into a single hyphen; a name that leaves nothing behind
 * produces an empty slug, which the form renders as "enter one yourself"
 * instead of inventing something unrecognisable.
 */
export const deriveWorkspaceSlug = (name: string): string =>
  name
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, WORKSPACE_SLUG_MAX)
    .replace(/-+$/, '');

/**
 * Normalise a slug the user typed. Editing is allowed to pass through a
 * trailing hyphen or a short value so the inline validation can explain the
 * problem, but the result always stays inside the character set `create`
 * accepts.
 */
export const normalizeSlugInput = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .slice(0, WORKSPACE_SLUG_MAX);

/** Same bounds the server's zod schema enforces on `create`. */
export const isValidWorkspaceSlug = (slug: string): boolean =>
  slug.length >= WORKSPACE_SLUG_MIN &&
  slug.length <= WORKSPACE_SLUG_MAX &&
  isWorkspaceSlugFormatValid(slug);
