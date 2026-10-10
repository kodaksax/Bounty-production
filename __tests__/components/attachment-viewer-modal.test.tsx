import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/mock/cache/',
  copyAsync: jest.fn(),
  downloadAsync: jest.fn().mockResolvedValue({
    status: 200,
    uri: '/mock/cache/photo.jpg',
  }),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-video', () => ({
  VideoView: 'VideoView',
  useVideoPlayer: () => ({
    pause: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  }),
}));

jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AttachmentViewerModal } from '../../components/attachment-viewer-modal';

describe('AttachmentViewerModal', () => {
  it('downloads a remote image using the legacy filesystem API before sharing it', async () => {
    const uri = 'https://storage.example.com/messages/photo.jpg';
    const { getByLabelText } = render(
      <AttachmentViewerModal
        visible
        attachment={{
          id: 'photo',
          name: 'photo.jpg',
          uri,
          remoteUri: uri,
          mimeType: 'image/jpeg',
        }}
        onClose={jest.fn()}
      />
    );

    fireEvent.press(getByLabelText('Download attachment'));

    await waitFor(() => {
      expect(FileSystem.downloadAsync).toHaveBeenCalledWith(
        uri,
        '/mock/cache/photo.jpg'
      );
      expect(Sharing.shareAsync).toHaveBeenCalledWith(
        '/mock/cache/photo.jpg',
        expect.objectContaining({ mimeType: 'image/jpeg' })
      );
    });
  });
});
