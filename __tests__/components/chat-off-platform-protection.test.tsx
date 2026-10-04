import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as RN from 'react-native';
import type { Message } from '../../lib/types';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

const mockSend = jest.fn();
const mockPick = jest.fn();
let mockMessages: Message[] = [];
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../hooks/useMessages', () => ({
  useMessages: () => ({
    messages: mockMessages, loading: false, error: null,
    sendMessage: mockSend, retryMessage: jest.fn(), pinMessage: jest.fn(),
    unpinMessage: jest.fn(), copyMessage: jest.fn(),
  }),
}));
jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'self' }));
jest.mock('../../hooks/useNormalizedProfile', () => ({ useNormalizedProfile: () => ({ profile: null }) }));
jest.mock('../../hooks/useSocketStub', () => ({ useTypingIndicator: () => ({ current: new Set() }) }));
jest.mock('../../hooks/use-attachment-upload', () => ({
  useAttachmentUpload: () => ({ pickAttachment: mockPick, isPicking: false, isUploading: false }),
}));
jest.mock('../../lib/services/blocking-service', () => ({ blockingService: {} }));
jest.mock('../../lib/services/supabase-messaging', () => ({ generateInitials: () => 'AB' }));
jest.mock('../../lib/haptic-feedback', () => ({ useHapticFeedback: () => ({ triggerHaptic: jest.fn() }) }));
jest.mock('../../components/ui/keyboard-avoiding', () => ({
  KeyboardAvoidingScreen: ({ children }: any) => children,
}));
jest.mock('../../components/attachment-viewer-modal', () => ({ AttachmentViewerModal: () => null }));
jest.mock('../../components/EmojiPicker', () => ({ EmojiPicker: () => null }));
jest.mock('../../components/PinnedMessageHeader', () => ({ PinnedMessageHeader: () => null }));
jest.mock('../../components/MessageBubble', () => ({
  MessageBubble: ({ id, text, onLongPress }: any) => {
    const { Text } = require('react-native');
    return <Text onLongPress={() => onLongPress(id)}>{text}</Text>;
  },
}));
jest.mock('../../components/MessageActions', () => ({
  MessageActions: ({ visible, onReply }: any) => {
    const { Text } = require('react-native');
    return visible ? <Text onPress={onReply}>Reply action</Text> : null;
  },
}));
jest.mock('../../components/ReportModal', () => ({
  ReportModal: ({ visible, contentId }: any) => {
    const { Text } = require('react-native');
    return visible ? <Text>{`Reporting ${contentId}`}</Text> : null;
  },
}));

import { ChatDetailScreen } from '../../app/tabs/chat-detail-screen';
import { FullChatDetailScreen } from '../../app/tabs/full-chat-detail-screen';
import { StickyMessageInterface } from '../../components/sticky-message-interface';

const conversation = { id: 'conv', realConversationId: 'conv', name: 'Alice', isGroup: false, participantIds: ['self', 'alice'], messages: [] };
const attachment = { id: 'photo', name: 'photo.jpg', uri: 'file://photo.jpg', remoteUri: 'https://cdn.example.com/photo.jpg', mimeType: 'image/jpeg' };
const original: Message = { id: 'original', text: 'Can you help?', senderId: 'alice', conversationId: 'conv', createdAt: '2026-01-01T00:00:00Z' };

beforeAll(() => {
  // The shared Jest native mock uses a host FlatList; materialize its rows/footer.
  require('react-native').FlatList = React.forwardRef(({ data, renderItem, ListHeaderComponent, ListFooterComponent }: any, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), scrollToEnd: jest.fn(), scrollToIndex: jest.fn() }));
    return <RN.View>
      {typeof ListHeaderComponent === 'function' ? <ListHeaderComponent /> : ListHeaderComponent}
      {data.map((item: any, index: number) => <React.Fragment key={item.id}>{renderItem({ item, index })}</React.Fragment>)}
      {ListFooterComponent}
    </RN.View>;
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  global.requestAnimationFrame = jest.fn(callback => { callback(0); return 0; });
  mockMessages = [original];
  mockSend.mockResolvedValue(undefined);
  mockPick.mockResolvedValue([attachment]);
});
afterEach(() => jest.useRealTimers());

describe.each([
  ['primary', ChatDetailScreen],
  ['full', FullChatDetailScreen],
] as const)('%s chat progressive protection', (_name, Screen) => {
  it('warns inline, preserves draft/reply/attachment on Edit, and sends them only after Send anyway', async () => {
    const ui = render(<Screen conversation={conversation} />);
    fireEvent(ui.getByText(original.text), 'longPress');
    fireEvent.press(ui.getByText('Reply action'));
    await act(async () => { fireEvent.press(ui.getByLabelText('Add attachment')); });
    fireEvent.changeText(ui.getByLabelText('Message input field'), 'Pay me via Venmo @hunter');
    expect(ui.getByText(trustSafetyStrings.paymentRequest)).toBeTruthy();
    fireEvent.press(ui.getByLabelText('Send message'));
    expect(mockSend).not.toHaveBeenCalled();
    expect(RN.Alert.alert).toHaveBeenCalledTimes(1);
    await act(async () => { (RN.Alert.alert as jest.Mock).mock.calls[0][2][0].onPress(); });
    expect(ui.getByLabelText('Message input field').props.value).toBe('Pay me via Venmo @hunter');
    expect(ui.getByText('photo.jpg')).toBeTruthy();
    expect(ui.getByLabelText('Cancel reply')).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();

    fireEvent.press(ui.getByLabelText('Send message'));
    await act(async () => { (RN.Alert.alert as jest.Mock).mock.calls[1][2][1].onPress(); });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('Pay me via Venmo @hunter', attachment.remoteUri, original.id);
    expect(ui.getByLabelText('Message input field').props.value).toBe('');
    expect(ui.queryByText('photo.jpg')).toBeNull();
    expect(ui.queryByLabelText('Cancel reply')).toBeNull();
  });

  it('keeps ordinary and attachment-only sends on the existing path', async () => {
    const ui = render(<Screen conversation={conversation} />);
    fireEvent.changeText(ui.getByLabelText('Message input field'), 'Fix the cash register');
    await act(async () => { fireEvent.press(ui.getByLabelText('Send message')); });
    expect(mockSend).toHaveBeenLastCalledWith('Fix the cash register', null, null);
    await act(async () => { fireEvent.press(ui.getByLabelText('Add attachment')); });
    await act(async () => { fireEvent.press(ui.getByLabelText('Send message')); });
    expect(mockSend).toHaveBeenLastCalledWith('', attachment.remoteUri, null);
    expect(RN.Alert.alert).not.toHaveBeenCalled();
  });

  it('does not duplicate ordinary sends when tapped repeatedly before the await resumes', async () => {
    const ui = render(<Screen conversation={conversation} />);
    fireEvent.changeText(ui.getByLabelText('Message input field'), 'Thanks!');
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send message'));
      fireEvent.press(ui.getByLabelText('Send message'));
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it.each(['unmount', 'conversation change'])('does not send a benign draft after %s', async change => {
    const ui = render(<Screen conversation={conversation} />);
    fireEvent.changeText(ui.getByLabelText('Message input field'), 'Thanks!');
    const pending = ui.getByLabelText('Send message').props.onPress();
    if (change === 'unmount') ui.unmount();
    else ui.rerender(<Screen conversation={{ ...conversation, id: 'next', realConversationId: 'next' }} />);
    await act(async () => { await pending; });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('restores the composer after a failed approved send', async () => {
    mockSend.mockRejectedValueOnce(new Error('offline'));
    const ui = render(<Screen conversation={conversation} />);
    await act(async () => { fireEvent.press(ui.getByLabelText('Add attachment')); });
    fireEvent.changeText(ui.getByLabelText('Message input field'), 'Text me');
    fireEvent.press(ui.getByLabelText('Send message'));
    await act(async () => { (RN.Alert.alert as jest.Mock).mock.calls[0][2][1].onPress(); });
    expect(ui.getByLabelText('Message input field').props.value).toBe('Text me');
    expect(ui.getByText('photo.jpg')).toBeTruthy();
  });

  it('shows one incoming warning and reports the latest actual flagged message', () => {
    mockMessages = [
      { ...original, id: 'old-risk', text: 'Text me' },
      { ...original, id: 'new-risk', text: 'Pay me via Zelle', createdAt: '2026-01-02T00:00:00Z', isEncrypted: true },
      { ...original, id: 'outgoing', senderId: 'self', text: 'Pay me via Venmo', createdAt: '2026-01-03T00:00:00Z' },
      { ...original, id: 'wrong-conversation', conversationId: 'elsewhere', text: 'Text me', createdAt: '2026-01-04T00:00:00Z' },
    ];
    const ui = render(<Screen conversation={conversation} />);
    expect(ui.getAllByText(trustSafetyStrings.incomingRequest)).toHaveLength(1);
    expect(ui.queryByText(trustSafetyStrings.contactRequest)).toBeNull();
    expect(ui.queryByText(trustSafetyStrings.general)).toBeNull();
    fireEvent.press(ui.getByLabelText('Report this message'));
    expect(ui.getByText('Reporting new-risk')).toBeTruthy();
  });
});

describe('alternate sticky composer', () => {
  it('uses the same warning/confirmation and preserves the expanded draft on Edit', async () => {
    const ui = render(<StickyMessageInterface conversationId="conv" messages={[]} onSend={mockSend} />);
    const input = ui.getByLabelText('Message input field', { includeHiddenElements: true });
    fireEvent.changeText(input, 'Email me at worker@example.com');
    fireEvent.press(ui.getByText('Email me at worker@example.com'));
    expect(ui.getByText(trustSafetyStrings.contactRequest)).toBeTruthy();
    fireEvent.press(ui.getAllByLabelText('Send message', { includeHiddenElements: true }).slice(-1)[0]);
    expect(mockSend).not.toHaveBeenCalled();
    await act(async () => { (RN.Alert.alert as jest.Mock).mock.calls[0][2][0].onPress(); });
    expect(ui.getByLabelText('Message input field').props.value).toBe('Email me at worker@example.com');
    fireEvent.press(ui.getAllByLabelText('Send message', { includeHiddenElements: true }).slice(-1)[0]);
    await act(async () => { (RN.Alert.alert as jest.Mock).mock.calls[1][2][1].onPress(); });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('Email me at worker@example.com');
  });

  it('reports only the latest incoming flagged message, not outgoing messages', () => {
    const ui = render(<StickyMessageInterface conversationId="conv" messages={[
      { id: 'old', text: 'Text me', createdAt: 1, isUser: false },
      { id: 'latest', text: 'Pay me via Zelle', createdAt: 2, isUser: false },
      { id: 'own', text: 'Text me', createdAt: 3, isUser: true },
    ]} onSend={mockSend} />);
    expect(ui.getAllByText(trustSafetyStrings.incomingRequest)).toHaveLength(1);
    expect(ui.queryByText(trustSafetyStrings.general)).toBeNull();
    fireEvent.press(ui.getByLabelText('Report this message'));
    expect(ui.getByText('Reporting latest')).toBeTruthy();
  });

  it('does not duplicate a benign collapsed-composer send on rapid taps', async () => {
    const ui = render(<StickyMessageInterface conversationId="conv" messages={[]} onSend={mockSend} />);
    fireEvent.changeText(ui.getByLabelText('Message input field', { includeHiddenElements: true }), 'Thanks!');
    const collapsedSend = ui.getAllByLabelText('Send message', { includeHiddenElements: true })[0];
    await act(async () => {
      fireEvent.press(collapsedSend);
      fireEvent.press(collapsedSend);
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('preserves the sticky draft when an asynchronous send fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('offline'));
    const ui = render(<StickyMessageInterface conversationId="conv" messages={[]} onSend={mockSend} />);
    fireEvent.changeText(ui.getByLabelText('Message input field', { includeHiddenElements: true }), 'Thanks!');
    await act(async () => {
      fireEvent.press(ui.getAllByLabelText('Send message', { includeHiddenElements: true })[0]);
    });
    expect(ui.getByLabelText('Message input field', { includeHiddenElements: true }).props.value).toBe('Thanks!');
  });

  it.each(['unmount', 'conversation change'])('does not send a benign sticky draft after %s', async change => {
    const ui = render(<StickyMessageInterface conversationId="conv" messages={[]} onSend={mockSend} />);
    fireEvent.changeText(ui.getByLabelText('Message input field', { includeHiddenElements: true }), 'Thanks!');
    const pending = ui.getAllByLabelText('Send message', { includeHiddenElements: true })[0].props.onPress();
    if (change === 'unmount') ui.unmount();
    else ui.rerender(<StickyMessageInterface conversationId="next" messages={[]} onSend={mockSend} />);
    await act(async () => { await pending; });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
