import { storageService } from '../../../lib/services/storage-service';

// Mock dependencies
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn().mockReturnThis(),
      upload: jest.fn(),
      getPublicUrl: jest.fn(),
      remove: jest.fn(),
    },
  },
}));

jest.mock('base64-arraybuffer', () => ({
  decode: jest.fn((base64: string) => {
    // Simple mock: create an ArrayBuffer with length based on base64 string
    const buffer = new ArrayBuffer(Math.ceil((base64.length * 3) / 4));
    return buffer;
  }),
}));

jest.mock('../../../lib/utils/fs-utils', () => ({
  cacheDirectory: '/mock/cache/',
  copyTo: jest.fn(),
  readAsBase64: jest.fn(),
  writeBase64ToFile: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const { supabase } = require('../../../lib/supabase');
const { readAsBase64 } = require('../../../lib/utils/fs-utils');

describe('storage-service - Upload Optimizations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('withTimeout', () => {
    it('should resolve when promise completes before timeout', async () => {
      const mockUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
      supabase.storage.upload = mockUpload;
      supabase.storage.getPublicUrl = jest.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/file.jpg' },
      });

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      });

      const uploadPromise = storageService.uploadFile('file://test.jpg', {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
      });

      // Fast-forward time but promise should already be resolved
      jest.advanceTimersByTime(1000);

      const result = await uploadPromise;
      expect(result.success).toBe(true);
    });

    it('should reject when timeout is reached', async () => {
      // Mock a slow operation
      global.fetch = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 40000))
      );

      readAsBase64.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 40000))
      );

      const uploadPromise = storageService.uploadFile('file://test.jpg', {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
      });

      // Advance past all timeouts
      jest.advanceTimersByTime(50000);

      await expect(uploadPromise).rejects.toThrow();
    }, 60000);

    it('should clear timeout when promise completes', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      const mockUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
      supabase.storage.upload = mockUpload;
      supabase.storage.getPublicUrl = jest.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/file.jpg' },
      });

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      });

      await storageService.uploadFile('file://test.jpg', {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
      });

      // Timeout should have been cleared
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Promise.any polyfill', () => {
    it('should resolve with first successful method', async () => {
      const mockUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
      supabase.storage.upload = mockUpload;
      supabase.storage.getPublicUrl = jest.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/file.jpg' },
      });

      // Mock fetch to succeed quickly
      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      });

      const result = await storageService.uploadFile('file://test.jpg', {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
      });

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://example.com/file.jpg');
    });

    it('should try base64 fallback when fetch methods fail', async () => {
      const mockUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
      supabase.storage.upload = mockUpload;
      supabase.storage.getPublicUrl = jest.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/file.jpg' },
      });

      // Mock fetch to fail
      global.fetch = jest.fn().mockRejectedValue(new Error('Fetch failed'));

      // Mock base64 to succeed
      readAsBase64.mockResolvedValue('base64data');

      const result = await storageService.uploadFile('file://test.jpg', {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
      });

      expect(result.success).toBe(true);
      expect(readAsBase64).toHaveBeenCalled();
    });

    it('should handle data URI directly', async () => {
      const mockUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
      supabase.storage.upload = mockUpload;
      supabase.storage.getPublicUrl = jest.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/file.jpg' },
      });

      const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

      const result = await storageService.uploadFile(dataUri, {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
      });

      expect(result.success).toBe(true);
      // Should not call fetch for data URI
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('progress callbacks', () => {
    it('should call onProgress at key milestones', async () => {
      const mockUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
      supabase.storage.upload = mockUpload;
      supabase.storage.getPublicUrl = jest.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/file.jpg' },
      });

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      });

      const progressCallback = jest.fn();

      await storageService.uploadFile('file://test.jpg', {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
        onProgress: progressCallback,
      });

      // Should call progress at various stages
      expect(progressCallback).toHaveBeenCalledWith(0.1); // Initial
      expect(progressCallback).toHaveBeenCalledWith(0.3); // Before conversion
      expect(progressCallback).toHaveBeenCalledWith(0.5); // After conversion
      expect(progressCallback).toHaveBeenCalledWith(0.9); // After upload
      expect(progressCallback).toHaveBeenCalledWith(1.0); // Complete
    });
  });

  describe('error handling', () => {
    it('should provide detailed error message on timeout', async () => {
      global.fetch = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 40000))
      );

      readAsBase64.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 40000))
      );

      const uploadPromise = storageService.uploadFile('file://test.jpg', {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
      });

      jest.advanceTimersByTime(50000);

      await expect(uploadPromise).rejects.toThrow();
    }, 60000);

    it('should fallback to AsyncStorage when Supabase fails', async () => {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      AsyncStorage.setItem.mockResolvedValue(undefined);

      // Mock Supabase to fail
      supabase.storage.upload = jest.fn().mockRejectedValue(new Error('Upload failed'));

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      });

      const result = await storageService.uploadFile('file://test.jpg', {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
      });

      // Should still succeed with AsyncStorage fallback
      expect(result.fallbackToLocal).toBe(true);
    });
  });

  describe('content type detection', () => {
    it('should detect JPEG content type', async () => {
      const mockUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
      supabase.storage.upload = mockUpload;
      supabase.storage.getPublicUrl = jest.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/file.jpg' },
      });

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      });

      await storageService.uploadFile('file://test.jpg', {
        bucket: 'test-bucket',
        path: 'test/file.jpg',
      });

      // Check that upload was called with correct content type
      expect(mockUpload).toHaveBeenCalledWith(
        'test/file.jpg',
        expect.any(ArrayBuffer),
        expect.objectContaining({
          contentType: 'image/jpeg',
        })
      );
    });

    it('should detect PNG content type', async () => {
      const mockUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
      supabase.storage.upload = mockUpload;
      supabase.storage.getPublicUrl = jest.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/file.png' },
      });

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024)),
      });

      await storageService.uploadFile('file://test.png', {
        bucket: 'test-bucket',
        path: 'test/file.png',
      });

      expect(mockUpload).toHaveBeenCalledWith(
        'test/file.png',
        expect.any(ArrayBuffer),
        expect.objectContaining({
          contentType: 'image/png',
        })
      );
    });
  });

  describe('utility methods', () => {
    it('should check if Supabase is available', () => {
      expect(storageService.isSupabaseAvailable()).toBe(true);
    });

    it('should get public URL', () => {
      supabase.storage.getPublicUrl = jest.fn().mockReturnValue({
        data: { publicUrl: 'https://example.com/file.jpg' },
      });

      const url = storageService.getPublicUrl('test-bucket', 'test/file.jpg');
      expect(url).toBe('https://example.com/file.jpg');
    });

    it('should delete file', async () => {
      supabase.storage.remove = jest.fn().mockResolvedValue({ error: null });

      const result = await storageService.deleteFile('test-bucket', 'test/file.jpg');
      expect(result).toBe(true);
      expect(supabase.storage.remove).toHaveBeenCalledWith(['test/file.jpg']);
    });
  });
});
