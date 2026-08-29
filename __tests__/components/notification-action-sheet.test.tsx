import { fireEvent, render } from '@testing-library/react-native';
import { NotificationActionSheet } from '../../components/notifications/notification-action-sheet';
import type { Notification } from '../../lib/types';

const push = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('../../components/ui/app-modal', () => ({
  AppModal: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('lib/services/notification-service', () => ({
  notificationService: { markAsRead: jest.fn() },
}));

jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: { acceptRequest: jest.fn(), rejectRequest: jest.fn() },
}));

jest.mock('lib/services/supabase-messaging', () => ({
  sendMessage: jest.fn(),
}));

jest.mock('lib/config/notification-taxonomy', () => ({
  categoryForNotificationType: () => 'messages',
  isBundled: () => false,
}));

const messageNotification: Notification = {
  id: 'notification-id',
  user_id: 'user-id',
  type: 'message',
  category: 'messages',
  title: 'Message from a hunter',
  body: 'Is the camera provided?',
  data: { conversationId: 'conversation/id' },
  read: false,
  created_at: '2026-08-29T00:00:00.000Z',
};

describe('NotificationActionSheet', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('keeps the reply composer above the iOS keyboard', () => {
    const { UNSAFE_root } = render(
      <NotificationActionSheet notification={messageNotification} currentUserId="user-id" onClose={jest.fn()} />
    );

    const keyboardAvoider = UNSAFE_root.findByType('KeyboardAvoidingView');
    expect(keyboardAvoider.props.behavior).toBe('padding');
    expect(keyboardAvoider.props.style).toEqual({ flex: 1, justifyContent: 'flex-end' });
  });

  it('opens the notified conversation directly', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <NotificationActionSheet notification={messageNotification} currentUserId="user-id" onClose={onClose} />
    );

    fireEvent.press(getByText('View Conversation'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/tabs/messenger/conversation%2Fid');
  });
});
