/**
 * Unit tests for useAttachmentUpload hook
 * 
 * Tests the upload functionality with retry logic (3 attempts with exponential backoff),
 * file validation, progress tracking, and error handling.
 * 
 * @jest-environment node
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

// Mock dependencies
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: {
    All: 'All',
    Images: 'Images',
    Videos: 'Videos',
  },
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('../../../lib/services/storage-service', () => ({
  storageService: {
    uploadFile: jest.fn(),
  },
}));

jest.mock('../../../lib/utils/fs-utils', () => ({
  getFileInfo: jest.fn(),
}));

// Import after mocks
import { useAttachmentUpload } from '../../../hooks/use-attachment-upload';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { storageService } from '../../../lib/services/storage-service';
import { getFileInfo } from '../../../lib/utils/fs-utils';

describe('useAttachmentUpload', () => {
  const mockFile = {
    uri: 'file://test.jpg',
    name: 'test.jpg',
    mimeType: 'image/jpeg',
    size: 1024 * 1024, // 1MB
  };

  const mockUploadResult = {
    success: true,
    url: 'https://storage.example.com/test.jpg',
    error: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Alert.alert = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useAttachmentUpload());

      expect(result.current.isUploading).toBe(false);
      expect(result.current.isPicking).toBe(false);
      expect(result.current.progress).toBe(0);
      expect(result.current.error).toBe(null);
      expect(result.current.lastUploaded).toBe(null);
    });

    it('should accept custom options', () => {
      const onUploaded = jest.fn();
      const onError = jest.fn();

      const { result } = renderHook(() =>
        useAttachmentUpload({
          bucket: 'profiles',
          folder: 'avatars',
          allowedTypes: 'images',
          maxSizeMB: 5,
          onUploaded,
          onError,
        })
      );

      expect(result.current).toBeDefined();
    });
  });

  describe('File Picker - Photos', () => {
    it('should pick image from photo library', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      (storageService.uploadFile as jest.Mock).mockResolvedValue(mockUploadResult);

      const onUploaded = jest.fn();
      const { result } = renderHook(() =>
        useAttachmentUpload({ onUploaded })
      );

      await act(async () => {
        await result.current.pickAttachment('photos');
      });

      await waitFor(() => {
        expect(onUploaded).toHaveBeenCalled();
      });
    });

    it('should handle permission denial for photo library', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
        expires: 'never',
      } as any);

      const { result } = renderHook(() => useAttachmentUpload());

      await act(async () => {
        await result.current.pickAttachment('photos');
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        'Permission Required',
        'Photo library permission is required.'
      );
    });

    it('should handle user cancellation', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: true,
      } as any);

      const { result } = renderHook(() => useAttachmentUpload());

      await act(async () => {
        const attachment = await result.current.pickAttachment('photos');
        expect(attachment).toBeNull();
      });

      expect(result.current.isPicking).toBe(false);
      expect(result.current.isUploading).toBe(false);
    });
  });

  describe('File Picker - Camera', () => {
    it('should pick image from camera', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestCameraPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchCameraAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 1920,
            height: 1080,
            type: 'image',
            mimeType: 'image/jpeg',
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      (storageService.uploadFile as jest.Mock).mockResolvedValue(mockUploadResult);

      const onUploaded = jest.fn();
      const { result } = renderHook(() =>
        useAttachmentUpload({ onUploaded })
      );

      await act(async () => {
        await result.current.pickAttachment('camera');
      });

      await waitFor(() => {
        expect(onUploaded).toHaveBeenCalled();
      });
    });

    it('should handle permission denial for camera', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestCameraPermissionsAsync.mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
        expires: 'never',
      } as any);

      const { result } = renderHook(() => useAttachmentUpload());

      await act(async () => {
        await result.current.pickAttachment('camera');
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        'Permission Required',
        'Camera permission is required to take photos.'
      );
    });
  });

  describe('File Picker - Documents', () => {
    it('should pick document from file system', async () => {
      const mockDocumentPicker = DocumentPicker as jest.Mocked<typeof DocumentPicker>;
      mockDocumentPicker.getDocumentAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: 'file://document.pdf',
            name: 'document.pdf',
            mimeType: 'application/pdf',
            size: 2048 * 1024, // 2MB
          },
        ],
      } as any);

      (storageService.uploadFile as jest.Mock).mockResolvedValue(mockUploadResult);

      const onUploaded = jest.fn();
      const { result } = renderHook(() =>
        useAttachmentUpload({ allowedTypes: 'documents', onUploaded })
      );

      await act(async () => {
        await result.current.pickAttachment('files');
      });

      await waitFor(() => {
        expect(onUploaded).toHaveBeenCalled();
      });
    });
  });

  describe('File Validation', () => {
    it('should reject files that exceed max size', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      const largeFile = {
        uri: 'file://large.jpg',
        width: 4000,
        height: 3000,
        type: 'image',
        mimeType: 'image/jpeg',
      };

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [largeFile],
      } as any);

      // Mock large file size (10MB, exceeds 5MB limit)
      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: 10 * 1024 * 1024,
      });

      const onError = jest.fn();
      const { result } = renderHook(() =>
        useAttachmentUpload({ maxSizeMB: 5, onError })
      );

      await act(async () => {
        await result.current.pickAttachment('photos');
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        'File Too Large',
        'Maximum file size is 5MB'
      );
      expect(onError).toHaveBeenCalled();
      expect(result.current.error).toContain('File too large');
    });

    it('should accept files within size limit', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      // Mock file within limit (1MB < 5MB)
      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: 1 * 1024 * 1024,
      });

      (storageService.uploadFile as jest.Mock).mockResolvedValue(mockUploadResult);

      const onUploaded = jest.fn();
      const { result } = renderHook(() =>
        useAttachmentUpload({ maxSizeMB: 5, onUploaded })
      );

      await act(async () => {
        await result.current.pickAttachment('photos');
      });

      await waitFor(() => {
        expect(onUploaded).toHaveBeenCalled();
      });
    });
  });

  describe('Upload Retry Logic', () => {
    it('should retry upload 3 times with exponential backoff on failure', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      // Mock upload failure for all attempts
      (storageService.uploadFile as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      const onError = jest.fn();
      const { result } = renderHook(() =>
        useAttachmentUpload({ onError })
      );

      const uploadPromise = act(async () => {
        await result.current.pickAttachment('photos');
      });

      // Fast-forward through retry delays
      // First retry: 1s delay
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      // Second retry: 2s delay
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Third retry: 4s delay
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });

      await uploadPromise;

      // Should attempt upload 3 times
      expect(storageService.uploadFile).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenCalled();
      expect(result.current.error).toBeTruthy();
    });

    it('should succeed on second retry attempt', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      // First attempt fails, second succeeds
      (storageService.uploadFile as jest.Mock)
        .mockResolvedValueOnce({
          success: false,
          error: 'Network error',
        })
        .mockResolvedValueOnce(mockUploadResult);

      const onUploaded = jest.fn();
      const { result } = renderHook(() =>
        useAttachmentUpload({ onUploaded })
      );

      const uploadPromise = act(async () => {
        await result.current.pickAttachment('photos');
      });

      // Fast-forward through first retry delay (1s)
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      await uploadPromise;

      // Should attempt upload 2 times (initial + 1 retry)
      expect(storageService.uploadFile).toHaveBeenCalledTimes(2);
      expect(onUploaded).toHaveBeenCalled();
      expect(result.current.error).toBeNull();
    });

    it('should use exponential backoff delays (1s, 2s, 4s)', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      const uploadTimes: number[] = [];
      (storageService.uploadFile as jest.Mock).mockImplementation(() => {
        uploadTimes.push(Date.now());
        return Promise.resolve({ success: false, error: 'Network error' });
      });

      const { result } = renderHook(() => useAttachmentUpload());

      const uploadPromise = act(async () => {
        await result.current.pickAttachment('photos');
      });

      // Fast-forward through all retries
      await act(async () => {
        jest.advanceTimersByTime(1000); // First retry
      });
      await act(async () => {
        jest.advanceTimersByTime(2000); // Second retry
      });
      await act(async () => {
        jest.advanceTimersByTime(4000); // Third retry
      });

      await uploadPromise;

      // Verify 3 attempts were made
      expect(uploadTimes.length).toBe(3);
    });
  });

  describe('Progress Tracking', () => {
    it('should track upload progress', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      let progressCallback: ((progress: number) => void) | undefined;
      (storageService.uploadFile as jest.Mock).mockImplementation((uri, options) => {
        progressCallback = options.onProgress;
        return Promise.resolve(mockUploadResult);
      });

      const { result } = renderHook(() => useAttachmentUpload());

      await act(async () => {
        const promise = result.current.pickAttachment('photos');
        
        // Simulate progress updates
        if (progressCallback) {
          progressCallback(0.25);
          progressCallback(0.5);
          progressCallback(0.75);
          progressCallback(1);
        }
        
        await promise;
      });

      expect(result.current.progress).toBe(1);
    });

    it('should reset progress after successful upload', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      (storageService.uploadFile as jest.Mock).mockResolvedValue(mockUploadResult);

      const { result } = renderHook(() => useAttachmentUpload());

      await act(async () => {
        await result.current.pickAttachment('photos');
      });

      expect(result.current.isUploading).toBe(false);
      expect(result.current.progress).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should call onError callback on upload failure', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      (storageService.uploadFile as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Upload failed',
      });

      const onError = jest.fn();
      const { result } = renderHook(() =>
        useAttachmentUpload({ onError })
      );

      const uploadPromise = act(async () => {
        await result.current.pickAttachment('photos');
      });

      // Fast-forward through all retry delays
      await act(async () => {
        jest.advanceTimersByTime(1000 + 2000 + 4000);
      });

      await uploadPromise;

      expect(onError).toHaveBeenCalled();
      expect(result.current.error).toBeTruthy();
    });

    it('should show alert on upload failure after retries', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      (storageService.uploadFile as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      const { result } = renderHook(() => useAttachmentUpload());

      const uploadPromise = act(async () => {
        await result.current.pickAttachment('photos');
      });

      // Fast-forward through all retry delays
      await act(async () => {
        jest.advanceTimersByTime(1000 + 2000 + 4000);
      });

      await uploadPromise;

      expect(Alert.alert).toHaveBeenCalledWith(
        'Upload Failed',
        expect.stringContaining('Please check your connection and try again')
      );
    });

    it('should allow clearing error state', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      const mockStorageService = storageService as jest.Mocked<typeof storageService>;
      
      // Setup mocks for file picking and upload failure
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
        accessPrivileges: 'all',
      });

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [{
          uri: 'file://test.jpg',
          width: 100,
          height: 100,
          fileName: 'test.jpg',
        }],
      });

      // Mock upload to fail, triggering error state
      mockStorageService.uploadFile.mockRejectedValue(new Error('Upload failed'));

      const { result } = renderHook(() => useAttachmentUpload());

      // Trigger an actual error via pickAttachment
      await act(async () => {
        await result.current.pickAttachment('photos');
      });

      // Fast-forward through all retry delays
      await act(async () => {
        jest.advanceTimersByTime(1000 + 2000 + 4000);
      });

      // Verify error was set
      expect(result.current.error).toBeTruthy();

      // Clear error
      act(() => {
        result.current.clearError();
      });

      // Verify error is cleared
      expect(result.current.error).toBeNull();
    });
  });

  describe('State Management', () => {
    it('should track isPicking state during file selection', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      let resolveImagePicker: any;
      const imagePickerPromise = new Promise((resolve) => {
        resolveImagePicker = resolve;
      });

      mockImagePicker.launchImageLibraryAsync.mockReturnValue(imagePickerPromise as any);

      const { result } = renderHook(() => useAttachmentUpload());

      act(() => {
        result.current.pickAttachment('photos');
      });

      // Should be in picking state
      expect(result.current.isPicking).toBe(true);

      // Resolve the picker
      await act(async () => {
        resolveImagePicker({ canceled: true });
      });

      expect(result.current.isPicking).toBe(false);
    });

    it('should track isUploading state during upload', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      let resolveUpload: any;
      const uploadPromise = new Promise((resolve) => {
        resolveUpload = resolve;
      });

      (storageService.uploadFile as jest.Mock).mockReturnValue(uploadPromise);

      const { result } = renderHook(() => useAttachmentUpload());

      act(() => {
        result.current.pickAttachment('photos');
      });

      await waitFor(() => {
        expect(result.current.isUploading).toBe(true);
      });

      // Resolve the upload
      await act(async () => {
        resolveUpload(mockUploadResult);
      });

      expect(result.current.isUploading).toBe(false);
    });

    it('should store lastUploaded attachment', async () => {
      const mockImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
      mockImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as any);

      mockImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: mockFile.uri,
            width: 800,
            height: 600,
            type: 'image',
            mimeType: mockFile.mimeType,
          },
        ],
      } as any);

      (getFileInfo as jest.Mock).mockResolvedValue({
        exists: true,
        size: mockFile.size,
      });

      (storageService.uploadFile as jest.Mock).mockResolvedValue(mockUploadResult);

      const { result } = renderHook(() => useAttachmentUpload());

      await act(async () => {
        await result.current.pickAttachment('photos');
      });

      expect(result.current.lastUploaded).not.toBeNull();
      expect(result.current.lastUploaded?.remoteUri).toBe(mockUploadResult.url);
      expect(result.current.lastUploaded?.status).toBe('uploaded');
    });

    it('should reset all state', () => {
      const { result } = renderHook(() => useAttachmentUpload());

      // Set some state
      act(() => {
        (result.current as any).isUploading = true;
        (result.current as any).progress = 0.5;
        (result.current as any).error = 'Test error';
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.isUploading).toBe(false);
      expect(result.current.isPicking).toBe(false);
      expect(result.current.progress).toBe(0);
      expect(result.current.error).toBeNull();
      expect(result.current.lastUploaded).toBeNull();
    });
  });
});
