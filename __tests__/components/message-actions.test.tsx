import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { MessageActions } from '../../components/MessageActions';

describe('MessageActions', () => {
  it('renders restored pin, report, and block actions', () => {
    const onClose = jest.fn();
    const onReply = jest.fn();
    const onPin = jest.fn();
    const onCopy = jest.fn();
    const onReport = jest.fn();
    const onBlockUser = jest.fn();

    const { getByText, getByLabelText } = render(
      <MessageActions
        visible
        onClose={onClose}
        onReply={onReply}
        onPin={onPin}
        onCopy={onCopy}
        onReport={onReport}
        onBlockUser={onBlockUser}
        isPinned={false}
        showBlockOption
      />
    );

    expect(getByText('Reply')).toBeTruthy();
    expect(getByText('Pin Message')).toBeTruthy();
    expect(getByText('Copy Text')).toBeTruthy();
    expect(getByText('Report Message')).toBeTruthy();
    expect(getByText('Block User')).toBeTruthy();

    fireEvent.press(getByLabelText('Pin message'));
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows unpin text when the message is already pinned', () => {
    const { getByText, queryByText } = render(
      <MessageActions
        visible
        onClose={jest.fn()}
        onPin={jest.fn()}
        onCopy={jest.fn()}
        onReport={jest.fn()}
        isPinned
        showBlockOption={false}
      />
    );

    expect(getByText('Unpin Message')).toBeTruthy();
    expect(queryByText('Block User')).toBeNull();
  });
});
