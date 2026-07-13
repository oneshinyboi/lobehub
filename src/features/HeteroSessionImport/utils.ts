import type {
  HeteroSessionDigest,
  HeteroSessionImportSource,
  HeteroSessionImportStatus,
} from '@lobechat/types';

export type SessionStatus = 'imported' | 'linked' | 'new' | 'syncable';

export type ImportRowState = { inserted: number; ok: true } | { ok: false } | 'pending' | 'running';

export const dirKeyOf = (source: HeteroSessionImportSource, workingDirectory: string) =>
  `${source}::${workingDirectory}`;

export const topicClientIdOf = (digest: HeteroSessionDigest) =>
  `${digest.source}-session-${digest.sessionId}`;

export const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
};

export const baseName = (dir: string) => dir.split('/').pop() ?? dir;

/**
 * Derive the badge status of one session from the server-side import status:
 * - linked: the session originated from a LobeHub live run — importing would duplicate it
 * - syncable: imported before, and the local transcript grew since (endAt fingerprint)
 * - imported: imported and unchanged
 */
export const deriveSessionStatus = (
  digest: HeteroSessionDigest,
  status: HeteroSessionImportStatus | undefined,
): SessionStatus => {
  if (!status) return 'new';
  if (status.linked.includes(digest.sessionId)) return 'linked';
  const imported = status.imported.find((i) => i.topicClientId === topicClientIdOf(digest));
  if (!imported) return 'new';
  if (digest.endAt && imported.sourceEndAt && digest.endAt > imported.sourceEndAt)
    return 'syncable';
  return 'imported';
};

/**
 * Can the user pick this row at all?
 *
 * Import is idempotent by construction — every entity carries a deterministic
 * `clientId` derived from the transcript, and the importer skips the ones that
 * already exist — so re-importing an unchanged session is a no-op on content and
 * safe to offer. It is also the ONLY way to repair a topic whose rows were
 * written by an older importer (e.g. subagent threads imported before they could
 * be anchored to their tool call): the transcript hasn't grown, so `syncable`
 * will never become true, yet a re-import rewrites the thread metadata.
 *
 * `linked` is the one status that stays unpickable: the session came from a
 * LobeHub live run, so its conversation is already here and importing it would
 * duplicate it.
 */
export const pickable = (status: SessionStatus) => status !== 'linked';

/**
 * Does "Select all" include this row?
 *
 * Narrower than {@link pickable} on purpose: a machine holds thousands of local
 * transcripts, and sweeping every already-imported one into a bulk re-import
 * would re-read and re-upload them all for no new content. Bulk means "everything
 * that has something to import"; repairing an unchanged session stays a
 * deliberate, per-row action.
 */
export const bulkSelectable = (status: SessionStatus) => status === 'new' || status === 'syncable';
