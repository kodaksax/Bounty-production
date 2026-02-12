/**
 * Unit tests for image-utils upload optimizations
 * 
 * These tests verify the following optimizations:
 * 1. resizeImage reuses initial result to avoid redundant ImageManipulator calls
 * 2. processImage uses uncompressed base for compression iterations
 * 3. processImage ensures MIN_COMPRESS_QUALITY is tried if binary search fails
 * 4. processImage combines crop+resize operations into single call
 * 5. processAvatarImage minimizes dimension fetches
 * 
 * To run these tests:
 *   npm test -- __tests__/unit/utils/image-utils-optimizations.test.ts
 * 
 * Or run all unit tests:
 *   npm run test:unit
 */

import * as ImageManipulator from 'expo-image-manipulator';
import {
  processImage,
  processAvatarImage,
  resizeImage,
  compressImage,
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

const mockManipulateAsync = ImageManipulator.manipulateAsync as jest.MockedFunction<
  typeof ImageManipulator.manipulateAsync
>;

describe('image-utils - Upload Optimizations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resizeImage - Optimization: Reuse initial result', () => {
    /**
     * Test: Verify that when an image is already within bounds,
     * we don't call ImageManipulator twice
     */
    it('should reuse initial result when image is within bounds', async () => {
      // Mock initial fetch to get dimensions
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://test-image.jpg',
        width: 400,
        height: 400,
      });

      const result = await resizeImage('file://source.jpg', 800, 800);

      // Should only call manipulateAsync once (to get dimensions)
      expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
      expect(result.uri).toBe('file://test-image.jpg');
      expect(result.width).toBe(400);
      expect(result.height).toBe(400);
    });

    /**
     * Test: Verify that when dimensions are provided,
     * we skip the initial dimension fetch entirely
     */
    it('should use provided dimensions when available', async () => {
      // When dimensions are provided, no initial fetch should happen
      const result = await resizeImage(
        'file://source.jpg',
        800,
        800,
        { width: 400, height: 400 }
      );

      // Should not call manipulateAsync at all when within bounds
      expect(mockManipulateAsync).toHaveBeenCalledTimes(0);
      expect(result.width).toBe(400);
      expect(result.height).toBe(400);
    });

    it('should resize when dimensions exceed maximum', async () => {
      // Image needs resizing
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://resized.jpg',
        width: 800,
        height: 800,
      });

      const result = await resizeImage(
        'file://source.jpg',
        800,
        800,
        { width: 1600, height: 1600 }
      );

      expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
      expect(mockManipulateAsync).toHaveBeenCalledWith(
        'file://source.jpg',
        [{ resize: { width: 800, height: 800 } }],
        { format: ImageManipulator.SaveFormat.JPEG }
      );
    });

    it('should maintain aspect ratio when resizing', async () => {
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://resized.jpg',
        width: 400,
        height: 800,
      });

      await resizeImage(
        'file://source.jpg',
        400,
        800,
        { width: 800, height: 1600 }
      );

      expect(mockManipulateAsync).toHaveBeenCalledWith(
        'file://source.jpg',
        [{ resize: { width: 400, height: 800 } }],
        { format: ImageManipulator.SaveFormat.JPEG }
      );
    });
  });

  describe('processImage - Optimization: Binary Search with uncompressed base', () => {
    /**
     * Test: Verify that if initial compression meets target,
     * we don't do any additional compression iterations
     */
    it('should return immediately if initial compression meets target', async () => {
      const smallBase64 = 'A'.repeat(1000); // ~750 bytes, under 500KB target
      
      mockManipulateAsync
        .mockResolvedValueOnce({
          uri: 'file://processed.jpg',
          width: 400,
          height: 400,
          base64: smallBase64,
        });

      const result = await processImage('file://source.jpg', {
        maxWidth: 400,
        maxHeight: 400,
        maxFileSizeBytes: 500 * 1024,
      });

      // Should only call once for initial processing
      expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
      expect(result.uri).toBe('file://processed.jpg');
    });

    /**
     * Test: Verify that we create an uncompressed base (compress: 1)
     * before doing binary search compression iterations.
     * This prevents compounding artifacts from recompressing already-compressed images.
     */
    it('should create uncompressed base for compression iterations', async () => {
      const largeBase64 = 'A'.repeat(2000000); // ~1.5MB, over 500KB target
      const mediumBase64 = 'A'.repeat(600000); // ~450KB, under target

      // Initial processing
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://initial.jpg',
        width: 400,
        height: 400,
        base64: largeBase64,
      });

      // Create uncompressed base (compress: 1) - note: no base64 property
      // Don't include base64 property at all since compress: 1 without base64: true doesn't return it
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://base-uncompressed.jpg',
        width: 400,
        height: 400,
      } as any);

      // Binary search iteration - this will have base64 since we request it
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://compressed.jpg',
        width: 400,
        height: 400,
        base64: mediumBase64,
      } as any);

      const result = await processImage('file://source.jpg', {
        maxWidth: 400,
        maxHeight: 400,
        maxFileSizeBytes: 500 * 1024,
      });

      // Should create base with compress: 1 (no base64: true option)
      expect(mockManipulateAsync).toHaveBeenNthCalledWith(
        2,
        'file://initial.jpg',
        [],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );

      // Result should have base64 from the binary search iteration, not from uncompressed base
      expect(result.base64).toBeDefined();
      expect(result.uri).toBe('file://compressed.jpg');
    });

    /**
     * Test: Verify that if binary search doesn't find a solution,
     * we try MIN_COMPRESS_QUALITY as a last resort
     */
    it('should try MIN_COMPRESS_QUALITY if binary search does not find solution', async () => {
      const largeBase64 = 'A'.repeat(2000000); // ~1.5MB, always over target
      const stillLargeBase64 = 'A'.repeat(1800000);
      const finalBase64 = 'A'.repeat(600000); // ~450KB

      // Initial processing - over size
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://initial.jpg',
        width: 400,
        height: 400,
        base64: largeBase64,
      });

      // Uncompressed base
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://base.jpg',
        width: 400,
        height: 400,
      });

      // Binary search iterations - still too large
      // The binary search will try midpoints between 0.3 (MIN) and 0.8 (initial quality)
      // First try: (0.3 + 0.8) / 2 = 0.55
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://iter1.jpg',
        width: 400,
        height: 400,
        base64: stillLargeBase64,
      });

      // Second try: (0.3 + 0.55) / 2 = 0.425
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://iter2.jpg',
        width: 400,
        height: 400,
        base64: stillLargeBase64,
      });

      // Third try: (0.3 + 0.425) / 2 = 0.3625
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://iter3.jpg',
        width: 400,
        height: 400,
        base64: stillLargeBase64,
      });

      // After iterations, lowQuality will be > 0.3, so MIN_COMPRESS_QUALITY (0.3) will be tried
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://min-quality.jpg',
        width: 400,
        height: 400,
        base64: finalBase64,
      });

      const result = await processImage('file://source.jpg', {
        maxWidth: 400,
        maxHeight: 400,
        maxFileSizeBytes: 500 * 1024,
      });

      // Should eventually try MIN_COMPRESS_QUALITY (0.3)
      const minQualityCall = (mockManipulateAsync.mock.calls as any[]).find(
        call => call[2]?.compress === 0.3
      );
      expect(minQualityCall).toBeDefined();
      expect(result.uri).toBe('file://min-quality.jpg');
    });

    /**
     * Test: Verify that crop and resize operations are combined
     * into a single ImageManipulator call
     */
    it('should combine crop and resize operations', async () => {
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://combined.jpg',
        width: 400,
        height: 400,
        base64: 'AAA',
      });

      await processImage('file://source.jpg', {
        crop: { originX: 100, originY: 100, width: 800, height: 800 },
        maxWidth: 400,
        maxHeight: 400,
      });

      // Should call with both crop and resize in one operation
      expect(mockManipulateAsync).toHaveBeenCalledWith(
        'file://source.jpg',
        expect.arrayContaining([
          { crop: { originX: 100, originY: 100, width: 800, height: 800 } },
          { resize: { width: 400, height: 400 } },
        ]),
        expect.objectContaining({
          compress: 0.8,
          base64: true,
        })
      );
    });
  });

  describe('processAvatarImage - Optimization: Minimize dimension fetches', () => {
    /**
     * Test: Verify that we get dimensions once and reuse them
     */
    it('should get dimensions once and pass to processImage', async () => {
      // Get dimensions
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://dimension-check.jpg',
        width: 800,
        height: 600,
      });

      // Combined processing
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://processed-avatar.jpg',
        width: 400,
        height: 400,
        base64: 'AAA',
      });

      await processAvatarImage('file://source.jpg', 400);

      // First call gets dimensions with minimal compression
      expect(mockManipulateAsync).toHaveBeenNthCalledWith(
        1,
        'file://source.jpg',
        [],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );

      // Second call does combined crop+resize+compress
      expect(mockManipulateAsync).toHaveBeenNthCalledWith(
        2,
        'file://source.jpg',
        expect.arrayContaining([
          expect.objectContaining({ crop: expect.any(Object) }),
        ]),
        expect.objectContaining({
          compress: 0.8,
          base64: true,
        })
      );
    });

    it('should create centered square crop for landscape images', async () => {
      // Landscape image
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://dimension-check.jpg',
        width: 1920,
        height: 1080,
      });

      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://processed.jpg',
        width: 400,
        height: 400,
        base64: 'AAA',
      });

      await processAvatarImage('file://landscape.jpg', 400);

      const cropCall = mockManipulateAsync.mock.calls[1];
      const operations = cropCall[1] as any[];
      const cropOp = operations.find((op: any) => op.crop);

      expect(cropOp.crop).toEqual({
        originX: 420, // (1920 - 1080) / 2
        originY: 0,
        width: 1080,
        height: 1080,
      });
    });
  });

  describe('compressImage', () => {
    it('should compress image with specified quality', async () => {
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://compressed.jpg',
        width: 400,
        height: 400,
        base64: 'compressed-data',
      } as any);

      const result = await compressImage('file://source.jpg', 0.5, 'jpeg');

      expect(mockManipulateAsync).toHaveBeenCalledWith(
        'file://source.jpg',
        [],
        {
          compress: 0.5,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }
      );
      expect(result.base64).toBe('compressed-data');
      expect(result.uri).toBe('file://compressed.jpg');
    });

    it('should support PNG format', async () => {
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://compressed.png',
        width: 400,
        height: 400,
        base64: 'png-data',
      } as any);

      await compressImage('file://source.jpg', 0.8, 'png');

      expect(mockManipulateAsync).toHaveBeenCalledWith(
        'file://source.jpg',
        [],
        {
          compress: 0.8,
          format: ImageManipulator.SaveFormat.PNG,
          base64: true,
        }
      );
    });

    it('should support WebP format', async () => {
      mockManipulateAsync.mockResolvedValueOnce({
        uri: 'file://compressed.webp',
        width: 400,
        height: 400,
        base64: 'webp-data',
      } as any);

      await compressImage('file://source.jpg', 0.8, 'webp');

      expect(mockManipulateAsync).toHaveBeenCalledWith(
        'file://source.jpg',
        [],
        {
          compress: 0.8,
          format: ImageManipulator.SaveFormat.WEBP,
          base64: true,
        }
      );
    });
  });
});
