/**
 * Component tests for MessageBubble attachment rendering.
 *
 * Regression guard: the bubble used to render only `text`, so a message whose
 * content was an uploaded image (empty text + media_url) drew an empty bubble.
 */

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

jest.mock('expo-image', () => ({ Image: 'Image' }));

import { MessageBubble } from '../../components/MessageBubble';

const IMAGE_URL = 'https://cdn.example.com/messages/photo.jpg';
const PDF_URL = 'https://cdn.example.com/messages/contract.pdf';

describe('MessageBubble attachments', () => {
  it('renders an image attachment', () => {
    const { getByLabelText } = render(
      <MessageBubble id="m1" text="" mediaUrl={IMAGE_URL} isUser status="sent" />
    );

    expect(getByLabelText('Open image attachment')).toBeTruthy();
  });

  it('renders the caption alongside the image', () => {
    const { getByText, getByLabelText } = render(
      <MessageBubble id="m1" text="check this out" mediaUrl={IMAGE_URL} isUser status="sent" />
    );

    expect(getByLabelText('Open image attachment')).toBeTruthy();
    expect(getByText('check this out')).toBeTruthy();
  });

  it('renders a file chip for non-previewable attachments', () => {
    const { getByText } = render(
      <MessageBubble id="m1" text="" mediaUrl={PDF_URL} isUser status="sent" />
    );

    expect(getByText('contract.pdf')).toBeTruthy();
  });

  it('calls onMediaPress with the media URL when tapped', () => {
    const onMediaPress = jest.fn();
    const { getByLabelText } = render(
      <MessageBubble
        id="m1"
        text=""
        mediaUrl={IMAGE_URL}
        isUser
        status="sent"
        onMediaPress={onMediaPress}
      />
    );

    fireEvent.press(getByLabelText('Open image attachment'));

    expect(onMediaPress).toHaveBeenCalledWith(IMAGE_URL);
  });

  it('renders nothing media-related for a plain text message', () => {
    const { queryByLabelText, getByText } = render(
      <MessageBubble id="m1" text="just text" isUser status="sent" />
    );

    expect(queryByLabelText('Open image attachment')).toBeNull();
    expect(getByText('just text')).toBeTruthy();
  });

  it('still offers retry on a failed attachment message', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <MessageBubble
        id="m1"
        text=""
        mediaUrl={IMAGE_URL}
        isUser
        status="failed"
        onRetry={onRetry}
      />
    );

    fireEvent.press(getByText('Retry'));

    expect(onRetry).toHaveBeenCalledWith('m1');
  });

  it('renders an emoji-only message without an attachment', () => {
    const { getByText, queryByLabelText } = render(
      <MessageBubble id="m1" text="🎉🎉" isUser status="sent" />
    );

    expect(getByText('🎉🎉')).toBeTruthy();
    expect(queryByLabelText('Open image attachment')).toBeNull();
  });
});
