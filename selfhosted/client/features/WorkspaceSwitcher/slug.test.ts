import { describe, expect, it } from 'vitest';

import { deriveWorkspaceSlug, isValidWorkspaceSlug, normalizeSlugInput } from './slug';

describe('deriveWorkspaceSlug', () => {
  it.each([
    ['Design team', 'design-team'],
    ['  Design   Team  ', 'design-team'],
    ['Café & Co.', 'cafe-co'],
    ['Acme_2026', 'acme-2026'],
    ['多语言', ''],
  ])('derives %s as %s', (name, slug) => {
    expect(deriveWorkspaceSlug(name)).toBe(slug);
  });

  it('never leaves a trailing hyphen after truncating to the length limit', () => {
    const slug = deriveWorkspaceSlug('a'.repeat(40));

    expect(slug).toHaveLength(32);
    expect(slug.endsWith('-')).toBe(false);
    expect(isValidWorkspaceSlug(slug)).toBe(true);
  });
});

describe('normalizeSlugInput', () => {
  it('folds what the user types into the slug character set', () => {
    expect(normalizeSlugInput('My Team')).toBe('my-team');
    expect(normalizeSlugInput('a--b')).toBe('a-b');
    expect(normalizeSlugInput('Team 2!')).toBe('team-2-');
  });
});

describe('isValidWorkspaceSlug', () => {
  it('rejects a slug shorter than the server minimum', () => {
    expect(isValidWorkspaceSlug('ab')).toBe(false);
  });

  it.each(['-team', 'team-', 'Team', 'team_2', 'team 2'])('rejects %s', (slug) => {
    expect(isValidWorkspaceSlug(slug)).toBe(false);
  });

  it('accepts the bounds the server accepts', () => {
    expect(isValidWorkspaceSlug('abc')).toBe(true);
    expect(isValidWorkspaceSlug('a'.repeat(32))).toBe(true);
    expect(isValidWorkspaceSlug('a'.repeat(33))).toBe(false);
  });
});
