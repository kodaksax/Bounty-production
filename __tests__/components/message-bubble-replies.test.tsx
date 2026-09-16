/**
 * Component tests for quoted replies in MessageBubble.
 *
 * A reply shows the message it answers as a quote block above its own text;
 * tapping the quote asks the screen to jump to the original.
 */

import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

jest.mock('expo-image', () => ({ Image: 'Image' }));

import { MessageBubble } from '../../components/MessageBubble';

describe('MessageBubble replies', () => {
  it('renders the quoted sender and text above the reply', () => {
    const { getByText } = render(
      <MessageBubble
        id="m2"
        text="yes, tomorrow works"
        isUser
        status="sent"
        replyTo={{ id: 'm1', senderLabel: 'alice', text: 'can we meet tomorrow?' }}
      />
    );

    expect(getByText('alice')).toBeTruthy();
    expect(getByText('can we meet tomorrow?')).toBeTruthy();
    expect(getByText('yes, tomorrow works')).toBeTruthy();
  });

  it('labels an attachment-only original instead of showing an empty quote', () => {
    const { getByText } = render(
      <MessageBubble
        id="m2"
        text="nice shot"
        isUser={false}
        replyTo={{ id: 'm1', senderLabel: 'You', text: '', mediaUrl: 'https://cdn.example.com/a.jpg' }}
      />
    );

    expect(getByText('📷 Photo')).toBeTruthy();
  });

  it('jumps to the original when the quote is tapped', () => {
    const onReplyPress = jest.fn();
    const { getByLabelText } = render(
      <MessageBubble
        id="m2"
        text="ok"
        isUser
        replyTo={{ id: 'm1', senderLabel: 'alice', text: 'hello' }}
        onReplyPress={onReplyPress}
      />
    );

    fireEvent.press(getByLabelText('Replying to alice: hello'));

    expect(onReplyPress).toHaveBeenCalledWith('m1');
  });

  it('says so when the original message is unavailable', () => {
    const { getByText } = render(<MessageBubble id="m2" text="ok" isUser replyTo={null} />);

    expect(getByText('Original message unavailable')).toBeTruthy();
  });

  it('renders no quote for an ordinary message', () => {
    const { queryByText } = render(<MessageBubble id="m1" text="hello" isUser />);

    expect(queryByText('Original message unavailable')).toBeNull();
  });
});
