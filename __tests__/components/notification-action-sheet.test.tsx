import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { NotificationActionSheet } from '../../components/notifications/notification-action-sheet';
import type { Notification } from '../../lib/types';

const push = jest.fn();

const originalOS = Platform.OS;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('../../components/ui/app-modal', () => ({
  AppModal: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('lib/services/notification-service', () => ({
  notificationService: { markAsRead: jest.fn(() => Promise.resolve()) },
}));

const mockAcceptRequest = jest.fn();
const mockRejectRequest = jest.fn();
jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    acceptRequest: (...a: unknown[]) => mockAcceptRequest(...a),
    rejectRequest: (...a: unknown[]) => mockRejectRequest(...a),
  },
}));

jest.mock('lib/services/supabase-messaging', () => ({
  sendMessage: jest.fn(),
}));

jest.mock('lib/config/notification-taxonomy', () => ({
  categoryForNotificationType: (type: string) => (type === 'application' ? 'marketplace' : 'messages'),
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
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  });

  it('keeps the reply composer above the iOS keyboard', () => {
    const { UNSAFE_root } = render(
      <NotificationActionSheet notification={messageNotification} currentUserId="user-id" onClose={jest.fn()} />
    );

    const keyboardAvoider = UNSAFE_root.findByType(KeyboardAvoidingView);
    expect(keyboardAvoider.props.behavior).toBe('padding');
    expect(StyleSheet.flatten(keyboardAvoider.props.style)).toEqual({ flex: 1, justifyContent: 'flex-end' });
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

  describe('application notifications', () => {
    const applicationNotification: Notification = {
      id: 'app-notification',
      user_id: 'poster-id',
      type: 'application',
      category: 'marketplace',
      title: 'New Bounty Application',
      body: 'Someone applied to your bounty',
      data: { bountyId: 'b1', requestId: 'req-1', hunterId: 'h1' },
      read: false,
      created_at: '2026-09-14T00:00:00.000Z',
    };

    beforeEach(() => {
      mockAcceptRequest.mockReset();
      mockRejectRequest.mockReset();
    });

    it('sends Accept through the Requests tab instead of accepting inline (funding confirmation lives there)', () => {
      const onClose = jest.fn();
      const { getByText } = render(
        <NotificationActionSheet notification={applicationNotification} currentUserId="poster-id" onClose={onClose} />
      );

      expect(getByText('View Requests')).toBeTruthy();

      fireEvent.press(getByText('Review & Accept'));

      expect(mockAcceptRequest).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith('/tabs/bounty-app?screen=messages&initialTab=requests');
    });

    it('tells the poster when a decline fails instead of failing silently', async () => {
      mockRejectRequest.mockRejectedValueOnce(new Error('offline'));
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const { getByText } = render(
        <NotificationActionSheet notification={applicationNotification} currentUserId="poster-id" onClose={jest.fn()} />
      );

      await act(async () => {
        fireEvent.press(getByText('Decline'));
      });

      expect(mockRejectRequest).toHaveBeenCalledWith('req-1');
      expect(alertSpy).toHaveBeenCalledWith("Couldn't decline", expect.any(String));
      jest.restoreAllMocks();
    });
  });
});
