/**
 * Mock filesystem and sharing helpers for testing
 * Prevents actual file I/O and sharing operations during tests
 */

/**
 * Mock expo-file-system module
 */
export function mockFileSystem() {
  const mockFs = {
    documentDirectory: '/mock/documents/',
    cacheDirectory: '/mock/cache/',
    writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
    readAsStringAsync: jest.fn().mockResolvedValue(''),
    deleteAsync: jest.fn().mockResolvedValue(undefined),
    getInfoAsync: jest.fn().mockResolvedValue({
      exists: true,
      isDirectory: false,
      uri: '/mock/file.txt',
      size: 1024,
      modificationTime: Date.now() / 1000,
    }),
    makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
    EncodingType: {
      UTF8: 'utf8',
      Base64: 'base64',
    },
  };

  jest.mock('expo-file-system', () => mockFs);
  jest.mock('expo-file-system/legacy', () => mockFs);
  
  return mockFs;
}

/**
 * Mock expo-sharing module
 */
export function mockSharing(options?: { isAvailable?: boolean; shouldSucceed?: boolean }) {
  const { isAvailable = true, shouldSucceed = true } = options || {};
  
  const mockSharing = {
    isAvailableAsync: jest.fn().mockResolvedValue(isAvailable),
    shareAsync: shouldSucceed
      ? jest.fn().mockResolvedValue(undefined)
      : jest.fn().mockRejectedValue(new Error('Sharing failed')),
  };

  jest.mock('expo-sharing', () => mockSharing);
  
  return mockSharing;
}

/**
 * Mock React Native Share module
 */
export function mockReactNativeShare(shouldSucceed = true) {
  const mockShare = {
    share: shouldSucceed
      ? jest.fn().mockResolvedValue({ action: 'sharedAction' })
      : jest.fn().mockRejectedValue(new Error('Share failed')),
  };

  return mockShare;
}

/**
 * Create a mock file system with initial files
 */
export function createMockFileSystem(initialFiles: Record<string, string> = {}) {
  const files = { ...initialFiles };
  
  return {
    documentDirectory: '/mock/documents/',
    cacheDirectory: '/mock/cache/',
    writeAsStringAsync: jest.fn().mockImplementation((path: string, content: string) => {
      files[path] = content;
      return Promise.resolve();
    }),
    readAsStringAsync: jest.fn().mockImplementation((path: string) => {
      if (files[path]) {
        return Promise.resolve(files[path]);
      }
      return Promise.reject(new Error(`File not found: ${path}`));
    }),
    deleteAsync: jest.fn().mockImplementation((path: string) => {
      delete files[path];
      return Promise.resolve();
    }),
    getInfoAsync: jest.fn().mockImplementation((path: string) => {
      const exists = !!files[path];
      return Promise.resolve({
        exists,
        isDirectory: false,
        uri: path,
        size: exists ? files[path].length : 0,
        modificationTime: Date.now() / 1000,
      });
    }),
    makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
    EncodingType: {
      UTF8: 'utf8',
      Base64: 'base64',
    },
    _files: files, // For test assertions
  };
}

/**
 * Reset all filesystem and sharing mocks
 */
export function resetFileSystemMocks() {
  jest.clearAllMocks();
}
