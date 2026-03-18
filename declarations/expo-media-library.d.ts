declare module 'expo-media-library' {
  export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | string;

  export function requestPermissionsAsync(): Promise<{ status: PermissionStatus }>;

  export function saveToLibraryAsync(localUri: string): Promise<void>;

  // Fallback any exports to avoid type errors in usage sites
  const _default: {
    requestPermissionsAsync: typeof requestPermissionsAsync;
    saveToLibraryAsync: typeof saveToLibraryAsync;
  };

  export default _default;
}
