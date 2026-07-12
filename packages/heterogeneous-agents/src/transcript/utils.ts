/**
 * Shared helpers for transcript parsers.
 */
import type { HeteroSessionImportImage } from '@lobechat/types';

const NUL = String.fromCodePoint(0);

/**
 * Stand-in emitted into a message's text for every embedded image, so the
 * position of each image inside the content survives parsing. The uploader
 * rewrites these placeholders one-for-one (in emission order) once it knows
 * which uploads succeeded — see `rewriteImagePlaceholders`.
 */
export const IMPORTED_IMAGE_PLACEHOLDER = '![imported image placeholder]';

/**
 * Resolve the placeholders left by the parsers against the outcome of each
 * upload, position-for-position (`images` must be in the parser's emission order
 * for this message). An image whose upload failed always keeps its placeholder —
 * losing the marker would silently erase the fact that an image was there.
 *
 * - `markdown` — for tool messages, whose renders show `pluginState.images` but
 *   not the message's file attachments. A markdown image also tells a model
 *   later handed this history that an image is here, and where.
 * - `strip` — for user messages, where the uploaded file renders as a native
 *   attachment thumbnail; keeping the marker too would double-render it.
 */
export const rewriteImagePlaceholders = (
  content: string,
  images: HeteroSessionImportImage[],
  mode: 'markdown' | 'strip',
): string => {
  if (!content.includes(IMPORTED_IMAGE_PLACEHOLDER)) return content;

  let index = 0;
  const rewritten = content.replaceAll(IMPORTED_IMAGE_PLACEHOLDER, () => {
    const image = images[index++];
    if (!image?.url) return IMPORTED_IMAGE_PLACEHOLDER;
    return mode === 'markdown' ? `![image](${image.url})` : '';
  });

  return rewritten.replaceAll(/\n{3,}/g, '\n\n').trim();
};

/**
 * Postgres rejects NUL characters in text/jsonb columns, and real-world
 * transcripts do contain them (e.g. binary tool output). Deep-strip real NUL
 * characters from every string in the value (literal `\u0000` escape sequences
 * that appear as text in code snippets are untouched).
 */
export const stripNulDeep = <T>(value: T): T => {
  if (typeof value === 'string')
    return (value.includes(NUL) ? value.replaceAll(NUL, '') : value) as T;
  if (Array.isArray(value)) return value.map((item) => stripNulDeep(item)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripNulDeep(v)])) as T;
  return value;
};

/**
 * Parse a JSONL transcript into records, silently skipping unparsable lines
 * (truncated writes, corrupt tails).
 */
export const parseJsonlRecords = (content: string): any[] => {
  const records: any[] = [];
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      /* skip bad line */
    }
  }
  return records;
};

/**
 * Timestamp fingerprint of a transcript's main conversation: the last raw
 * record of the given kind. The picker compares a fresh digest's `endAt` with
 * the `sourceEndAt` stored at import time to decide whether a session grew
 * ("New messages"), so BOTH must be produced by this one helper — deriving one
 * of them from the normalized messages instead makes them disagree (assistant
 * records sharing a `message.id` merge onto the first record's timestamp) and
 * every imported session then looks perpetually out of sync.
 */
export const transcriptEndAt = (
  records: any[],
  isConversational: (record: any) => boolean,
): string | undefined => records.findLast((r) => isConversational(r))?.timestamp;

export const truncateTitle = (text: string | undefined, max = 50): string | undefined => {
  const cleaned = text?.replaceAll(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
};

/**
 * Convert a raw Anthropic-shape usage object (Claude Code transcripts) into
 * the LobeHub `ModelUsage` shape stored in the messages `usage` column —
 * same mapping as the live adapter's `toUsageData`. Non-token extras
 * (`service_tier`, `speed`, `cache_creation`, …) must NOT land here; callers
 * relocate the meaningful ones into message metadata.
 */
export const toModelUsageFromAnthropic = (
  raw:
    | {
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      }
    | null
    | undefined,
): Record<string, number> | undefined => {
  if (!raw) return undefined;
  const inputCacheMissTokens = raw.input_tokens || 0;
  const inputCachedTokens = raw.cache_read_input_tokens || 0;
  const inputWriteCacheTokens = raw.cache_creation_input_tokens || 0;
  const totalInputTokens = inputCacheMissTokens + inputCachedTokens + inputWriteCacheTokens;
  const totalOutputTokens = raw.output_tokens || 0;
  if (totalInputTokens + totalOutputTokens === 0) return undefined;
  return {
    inputCacheMissTokens,
    ...(inputCachedTokens ? { inputCachedTokens } : {}),
    ...(inputWriteCacheTokens ? { inputWriteCacheTokens } : {}),
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

/**
 * Convert a Codex `token_count` usage object (`info.last_token_usage`) into
 * the LobeHub `ModelUsage` shape. Codex `input_tokens` INCLUDES the cached
 * portion, unlike Anthropic's cache-miss-only `input_tokens`.
 */
export const toModelUsageFromCodex = (
  raw:
    | {
        cached_input_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
        total_tokens?: number;
      }
    | null
    | undefined,
): Record<string, number> | undefined => {
  if (!raw) return undefined;
  const totalInputTokens = raw.input_tokens || 0;
  const inputCachedTokens = raw.cached_input_tokens || 0;
  const totalOutputTokens = raw.output_tokens || 0;
  if (totalInputTokens + totalOutputTokens === 0) return undefined;
  const outputReasoningTokens = raw.reasoning_output_tokens || 0;
  return {
    ...(inputCachedTokens
      ? { inputCacheMissTokens: totalInputTokens - inputCachedTokens, inputCachedTokens }
      : {}),
    ...(outputReasoningTokens ? { outputReasoningTokens } : {}),
    totalInputTokens,
    totalOutputTokens,
    totalTokens: raw.total_tokens || totalInputTokens + totalOutputTokens,
  };
};
