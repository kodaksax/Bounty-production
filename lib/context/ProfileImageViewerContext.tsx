/**
 * Global home for the full-screen profile photo viewer. Mounted once at the
 * app root (see app/_layout.tsx) so any screen can open it via
 * hooks/useProfileImageViewer without duplicating a modal per call site.
 */
import { ProfileImageViewer } from 'components/ProfileImageViewer';
import React, { createContext, useCallback, useMemo, useState } from 'react';

export interface ProfileImageViewerContextValue {
  visible: boolean;
  imageUrl: string | null;
  altText?: string;
  open: (imageUrl: string | null | undefined, altText?: string) => void;
  close: () => void;
}

interface ProfileImageViewerState {
  visible: boolean;
  imageUrl: string | null;
  altText?: string;
}

const INITIAL_STATE: ProfileImageViewerState = {
  visible: false,
  imageUrl: null,
  altText: undefined,
};

export const ProfileImageViewerContext = createContext<ProfileImageViewerContextValue | undefined>(
  undefined
);

export function ProfileImageViewerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProfileImageViewerState>(INITIAL_STATE);

  const open = useCallback((imageUrl: string | null | undefined, altText?: string) => {
    if (!imageUrl) return;
    // Ignore opens while a viewer is already showing — only one photo
    // viewer can be on screen at a time.
    setState(prev => (prev.visible ? prev : { visible: true, imageUrl, altText }));
  }, []);

  const close = useCallback(() => {
    setState(prev => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  const value = useMemo<ProfileImageViewerContextValue>(
    () => ({ visible: state.visible, imageUrl: state.imageUrl, altText: state.altText, open, close }),
    [state, open, close]
  );

  return (
    <ProfileImageViewerContext.Provider value={value}>
      {children}
      <ProfileImageViewer
        visible={state.visible}
        imageUrl={state.imageUrl}
        altText={state.altText}
        onRequestClose={close}
      />
    </ProfileImageViewerContext.Provider>
  );
}
