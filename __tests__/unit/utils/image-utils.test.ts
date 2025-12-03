import {
  estimateFileSizeFromBase64,
  getCenteredSquareCrop,
  MAX_IMAGE_WIDTH,
  MAX_IMAGE_HEIGHT,
  MAX_FILE_SIZE_BYTES,
  DEFAULT_COMPRESS_QUALITY,
  MIN_COMPRESS_QUALITY,
} from '../../../lib/utils/image-utils';

// Mock expo-image-manipulator
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: {
    JPEG: 'jpeg',
    PNG: 'png',
    WEBP: 'webp',
  },
}));

describe('image-utils', () => {
  describe('constants', () => {
    it('should have correct MAX_IMAGE_WIDTH', () => {
      expect(MAX_IMAGE_WIDTH).toBe(1920);
    });

    it('should have correct MAX_IMAGE_HEIGHT', () => {
      expect(MAX_IMAGE_HEIGHT).toBe(1080);
    });

    it('should have correct MAX_FILE_SIZE_BYTES (500KB)', () => {
      expect(MAX_FILE_SIZE_BYTES).toBe(500 * 1024);
    });

    it('should have correct DEFAULT_COMPRESS_QUALITY', () => {
      expect(DEFAULT_COMPRESS_QUALITY).toBe(0.8);
    });

    it('should have correct MIN_COMPRESS_QUALITY', () => {
      expect(MIN_COMPRESS_QUALITY).toBe(0.3);
    });
  });

  describe('estimateFileSizeFromBase64', () => {
    it('should correctly estimate file size from base64 string', () => {
      // Base64 increases size by ~33%, so reverse: original bytes ≈ base64Length * 3/4
      const base64 = 'AAAA'; // 4 characters
      expect(estimateFileSizeFromBase64(base64)).toBe(3);
    });

    it('should handle empty string', () => {
      expect(estimateFileSizeFromBase64('')).toBe(0);
    });

    it('should handle large base64 strings', () => {
      // 1000 base64 chars should give ~750 bytes
      const base64 = 'A'.repeat(1000);
      expect(estimateFileSizeFromBase64(base64)).toBe(750);
    });

    it('should round up for non-exact divisions', () => {
      // 5 characters: 5 * 3 / 4 = 3.75, should ceil to 4
      const base64 = 'AAAAA';
      expect(estimateFileSizeFromBase64(base64)).toBe(4);
    });
  });

  describe('getCenteredSquareCrop', () => {
    it('should return a centered square crop for landscape images', () => {
      const crop = getCenteredSquareCrop(1920, 1080);
      
      expect(crop.width).toBe(1080);
      expect(crop.height).toBe(1080);
      expect(crop.originX).toBe(420); // (1920 - 1080) / 2
      expect(crop.originY).toBe(0);
    });

    it('should return a centered square crop for portrait images', () => {
      const crop = getCenteredSquareCrop(1080, 1920);
      
      expect(crop.width).toBe(1080);
      expect(crop.height).toBe(1080);
      expect(crop.originX).toBe(0);
      expect(crop.originY).toBe(420); // (1920 - 1080) / 2
    });

    it('should return the full image for square images', () => {
      const crop = getCenteredSquareCrop(500, 500);
      
      expect(crop.width).toBe(500);
      expect(crop.height).toBe(500);
      expect(crop.originX).toBe(0);
      expect(crop.originY).toBe(0);
    });

    it('should handle small images', () => {
      const crop = getCenteredSquareCrop(100, 50);
      
      expect(crop.width).toBe(50);
      expect(crop.height).toBe(50);
      expect(crop.originX).toBe(25); // (100 - 50) / 2
      expect(crop.originY).toBe(0);
    });

    it('should handle 1:1 ratio at various sizes', () => {
      const sizes = [100, 256, 400, 1000, 2000];
      
      for (const size of sizes) {
        const crop = getCenteredSquareCrop(size, size);
        expect(crop.width).toBe(size);
        expect(crop.height).toBe(size);
        expect(crop.originX).toBe(0);
        expect(crop.originY).toBe(0);
      }
    });

    it('should use floor for odd dimension differences', () => {
      // 101x100: difference is 1, floor(1/2) = 0
      const crop = getCenteredSquareCrop(101, 100);
      
      expect(crop.width).toBe(100);
      expect(crop.height).toBe(100);
      expect(crop.originX).toBe(0);
      expect(crop.originY).toBe(0);
    });
  });
});
