import { nativeImage } from 'electron';

import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:heterogeneousAgent:compressTranscriptImage');

/** Long edge to fit within — the same ceiling the server-side attachment ingest uses. */
const MAX_DIMENSION = 1920;
/**
 * Byte budget for one imported image. A session routinely inlines dozens of
 * screenshots, and importing a whole directory multiplies that by the session
 * count — so the budget is tighter than the server's 3MB single-attachment one.
 */
const MAX_BYTES = 1024 * 1024;
/** floor for the shrink loop: below this an image is no longer worth reading */
const MIN_DIMENSION = 320;
const JPEG_QUALITY = 82;

/** Only raster formats `nativeImage` can decode AND re-encode. */
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png']);

export interface TranscriptImageBytes {
  data: string;
  mediaType: string;
}

/**
 * Shrink an oversized transcript image before it is uploaded.
 *
 * CLI transcripts inline full-resolution screenshots as base64 — a Retina
 * capture is commonly 3–8MB, and one session can hold dozens. Uploading them
 * untouched burns the user's storage quota and makes the import crawl, while
 * nothing in the chat ever renders them above ~1000px.
 *
 * Uses Electron's `nativeImage` rather than `sharp` (which the desktop app does
 * not bundle, and which would add a native dependency to the main process).
 *
 * An image already within budget is passed through UNTOUCHED — re-encoding it
 * would be a lossy no-op. Anything that cannot be decoded (a corrupt or exotic
 * payload) is also passed through: a failure to compress must never turn into a
 * failure to import.
 */
export const compressTranscriptImage = ({
  data,
  mediaType,
}: TranscriptImageBytes): TranscriptImageBytes => {
  if (!COMPRESSIBLE_TYPES.has(mediaType)) return { data, mediaType };

  const buffer = Buffer.from(data, 'base64');
  if (buffer.length <= MAX_BYTES) return { data, mediaType };

  try {
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return { data, mediaType };

    const { height, width } = image.getSize();
    if (!width || !height) return { data, mediaType };

    let longEdge = Math.min(MAX_DIMENSION, Math.max(width, height));
    let best: TranscriptImageBytes | undefined;

    // Shrink until the encoded result fits the budget. PNG keeps alpha and text
    // crisp, so it is tried first; a screenshot that stays oversized even at
    // 1920px falls back to JPEG, where the same pixels cost ~10x less.
    do {
      const scale = longEdge / Math.max(width, height);
      const resized =
        scale < 1
          ? image.resize({
              height: Math.max(1, Math.round(height * scale)),
              quality: 'good',
              width: Math.max(1, Math.round(width * scale)),
            })
          : image;

      const png = resized.toPNG();
      if (png.length <= MAX_BYTES) {
        best = { data: png.toString('base64'), mediaType: 'image/png' };
        break;
      }

      const jpeg = resized.toJPEG(JPEG_QUALITY);
      if (jpeg.length <= MAX_BYTES) {
        best = { data: jpeg.toString('base64'), mediaType: 'image/jpeg' };
        break;
      }

      best = { data: jpeg.toString('base64'), mediaType: 'image/jpeg' };
      longEdge = Math.round(longEdge * 0.8);
    } while (longEdge > MIN_DIMENSION);

    if (!best) return { data, mediaType };

    const compressed = Buffer.from(best.data, 'base64');
    // a pathological source can encode LARGER than it arrived — keep the original
    if (compressed.length >= buffer.length) return { data, mediaType };

    logger.debug(
      `compressed transcript image ${width}x${height} ${buffer.length}B → ${compressed.length}B (${best.mediaType})`,
    );
    return best;
  } catch (error) {
    logger.warn(`image compression failed, uploading original: ${(error as Error).message}`);
    return { data, mediaType };
  }
};
