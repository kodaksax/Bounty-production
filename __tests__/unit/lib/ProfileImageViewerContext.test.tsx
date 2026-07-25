/**
 * State-machine coverage for ProfileImageViewerProvider — the global
 * open/close logic backing the full-screen profile photo viewer. The
 * ProfileImageViewer component itself (gestures/animation) is mocked out
 * here so this suite can focus purely on the context contract: opening,
 * closing, guarding against a second simultaneous open, and ignoring a
 * missing image URL.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { TouchableOpacity } from 'react-native';

import { useProfileImageViewer } from '../../../hooks/useProfileImageViewer';
import { ProfileImageViewerProvider } from '../../../lib/context/ProfileImageViewerContext';

jest.mock('components/ProfileImageViewer', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    ProfileImageViewer: (props: { visible: boolean; imageUrl: string | null }) =>
      React.createElement(
        Text,
        { testID: 'viewer-state' },
        JSON.stringify({ visible: props.visible, imageUrl: props.imageUrl })
      ),
  };
});

function readState(getByTestId: (id: string) => any) {
  return JSON.parse(getByTestId('viewer-state').props.children as string);
}

function Consumer() {
  const { open, close } = useProfileImageViewer();
  return (
    <>
      <TouchableOpacity testID="open-a" onPress={() => open('https://example.com/a.jpg', 'A')} />
      <TouchableOpacity testID="open-b" onPress={() => open('https://example.com/b.jpg', 'B')} />
      <TouchableOpacity testID="open-empty" onPress={() => open(undefined)} />
      <TouchableOpacity testID="close" onPress={() => close()} />
    </>
  );
}

describe('ProfileImageViewerProvider', () => {
  it('starts closed with no image', () => {
    const { getByTestId } = render(
      <ProfileImageViewerProvider>
        <Consumer />
      </ProfileImageViewerProvider>
    );
    const state = readState(getByTestId);
    expect(state.visible).toBe(false);
    expect(state.imageUrl).toBeNull();
  });

  it('open() shows the viewer with the given image', () => {
    const { getByTestId } = render(
      <ProfileImageViewerProvider>
        <Consumer />
      </ProfileImageViewerProvider>
    );
    act(() => fireEvent.press(getByTestId('open-a')));
    const state = readState(getByTestId);
    expect(state.visible).toBe(true);
    expect(state.imageUrl).toBe('https://example.com/a.jpg');
  });

  it('ignores a second open() while one is already visible', () => {
    const { getByTestId } = render(
      <ProfileImageViewerProvider>
        <Consumer />
      </ProfileImageViewerProvider>
    );
    act(() => fireEvent.press(getByTestId('open-a')));
    act(() => fireEvent.press(getByTestId('open-b')));
    const state = readState(getByTestId);
    expect(state.imageUrl).toBe('https://example.com/a.jpg');
  });

  it('open() with a missing url is a no-op', () => {
    const { getByTestId } = render(
      <ProfileImageViewerProvider>
        <Consumer />
      </ProfileImageViewerProvider>
    );
    act(() => fireEvent.press(getByTestId('open-empty')));
    const state = readState(getByTestId);
    expect(state.visible).toBe(false);
    expect(state.imageUrl).toBeNull();
  });

  it('close() hides the viewer', () => {
    const { getByTestId } = render(
      <ProfileImageViewerProvider>
        <Consumer />
      </ProfileImageViewerProvider>
    );
    act(() => fireEvent.press(getByTestId('open-a')));
    act(() => fireEvent.press(getByTestId('close')));
    const state = readState(getByTestId);
    expect(state.visible).toBe(false);
  });

  it('allows opening a different image after closing', () => {
    const { getByTestId } = render(
      <ProfileImageViewerProvider>
        <Consumer />
      </ProfileImageViewerProvider>
    );
    act(() => fireEvent.press(getByTestId('open-a')));
    act(() => fireEvent.press(getByTestId('close')));
    act(() => fireEvent.press(getByTestId('open-b')));
    const state = readState(getByTestId);
    expect(state.visible).toBe(true);
    expect(state.imageUrl).toBe('https://example.com/b.jpg');
  });
});

describe('useProfileImageViewer', () => {
  it('throws when used outside a ProfileImageViewerProvider', () => {
    const BadConsumer = () => {
      useProfileImageViewer();
      return null;
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<BadConsumer />)).toThrow(
      'useProfileImageViewer must be used within a ProfileImageViewerProvider'
    );
    spy.mockRestore();
  });
});
