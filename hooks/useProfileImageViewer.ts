import { useContext } from 'react';

import { ProfileImageViewerContext } from 'lib/context/ProfileImageViewerContext';

/**
 * Opens/closes the global full-screen profile photo viewer mounted by
 * ProfileImageViewerProvider. Must be called from a component rendered
 * under that provider (it wraps the whole app in app/_layout.tsx).
 */
export function useProfileImageViewer() {
  const ctx = useContext(ProfileImageViewerContext);
  if (!ctx) {
    throw new Error('useProfileImageViewer must be used within a ProfileImageViewerProvider');
  }
  return ctx;
}
