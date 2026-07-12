import { nativeImage } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { compressTranscriptImage } from './compressTranscriptImage';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const MB = 1024 * 1024;

/** base64 of `size` bytes — stands in for an encoded image payload */
const bytes = (size: number) => Buffer.alloc(size, 1).toString('base64');

const fakeImage = (opts: {
  height?: number;
  isEmpty?: boolean;
  jpeg?: number;
  png?: number;
  width?: number;
}) => {
  const image: any = {
    getSize: () => ({ height: opts.height ?? 2000, width: opts.width ?? 3000 }),
    isEmpty: () => opts.isEmpty ?? false,
    resize: vi.fn(() => image),
    toJPEG: vi.fn(() => Buffer.alloc(opts.jpeg ?? 200 * 1024, 2)),
    toPNG: vi.fn(() => Buffer.alloc(opts.png ?? 800 * 1024, 3)),
  };
  return image;
};

describe('compressTranscriptImage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes an image already within budget through untouched', () => {
    const data = bytes(100 * 1024);
    const result = compressTranscriptImage({ data, mediaType: 'image/png' });

    expect(result).toEqual({ data, mediaType: 'image/png' });
    // re-encoding a small image would be a lossy no-op
    expect(nativeImage.createFromBuffer).not.toHaveBeenCalled();
  });

  it('passes a format it cannot re-encode through untouched', () => {
    const data = bytes(4 * MB);
    const result = compressTranscriptImage({ data, mediaType: 'image/gif' });

    expect(result).toEqual({ data, mediaType: 'image/gif' });
    expect(nativeImage.createFromBuffer).not.toHaveBeenCalled();
  });

  it('downscales an oversized screenshot to the long-edge ceiling, keeping PNG', () => {
    const image = fakeImage({ height: 2000, png: 800 * 1024, width: 3000 });
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue(image);

    const result = compressTranscriptImage({ data: bytes(5 * MB), mediaType: 'image/png' });

    // 3000x2000 fits into 1920 on the long edge, aspect preserved
    expect(image.resize).toHaveBeenCalledWith({
      height: 1280,
      quality: 'good',
      width: 1920,
    });
    expect(result.mediaType).toBe('image/png');
    expect(Buffer.from(result.data, 'base64')).toHaveLength(800 * 1024);
  });

  it('falls back to JPEG when the resized PNG is still over budget', () => {
    const image = fakeImage({ jpeg: 300 * 1024, png: 2 * MB });
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue(image);

    const result = compressTranscriptImage({ data: bytes(9 * MB), mediaType: 'image/png' });

    expect(result.mediaType).toBe('image/jpeg');
    expect(Buffer.from(result.data, 'base64')).toHaveLength(300 * 1024);
  });

  it('keeps the original when the source cannot be decoded', () => {
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue(fakeImage({ isEmpty: true }));

    const data = bytes(4 * MB);
    // a failure to compress must never become a failure to import
    expect(compressTranscriptImage({ data, mediaType: 'image/png' })).toEqual({
      data,
      mediaType: 'image/png',
    });
  });

  it('keeps the original when re-encoding would make it bigger', () => {
    const image = fakeImage({ jpeg: 3 * MB, png: 3 * MB });
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue(image);

    const data = bytes(1.2 * MB);
    expect(compressTranscriptImage({ data, mediaType: 'image/png' })).toEqual({
      data,
      mediaType: 'image/png',
    });
  });
});
