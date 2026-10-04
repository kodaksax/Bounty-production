import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { NotificationActionSheet } from '../../components/notifications/notification-action-sheet';
import type { Notification } from '../../lib/types';
import { sendMessage } from '../../lib/services/supabase-messaging';
import { notificationService } from '../../lib/services/notification-service';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';
import { messagingStrings } from '../../lib/strings/messaging';

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
    jest.clearAllMocks();
    (sendMessage as jest.Mock).mockResolvedValue(undefined);
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

  it('warns before a risky quick reply, preserves it on Edit, and sends only after Send anyway', async () => {
    const onClose = jest.fn();
    const onActionComplete = jest.fn();
    const ui = render(
      <NotificationActionSheet notification={messageNotification} currentUserId="user-id"
        onClose={onClose} onActionComplete={onActionComplete} />
    );
    fireEvent.changeText(ui.getByLabelText('Quick reply message'), 'Pay me via Venmo');
    expect(ui.getByText(trustSafetyStrings.paymentRequest)).toBeTruthy();
    fireEvent.press(ui.getByLabelText('Send quick reply'));
    expect(sendMessage).not.toHaveBeenCalled();
    await act(async () => { (Alert.alert as jest.Mock).mock.calls[0][2][0].onPress(); });
    expect(ui.getByLabelText('Quick reply message').props.value).toBe('Pay me via Venmo');
    expect(notificationService.markAsRead).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onActionComplete).not.toHaveBeenCalled();

    fireEvent.press(ui.getByLabelText('Send quick reply'));
    await act(async () => { (Alert.alert as jest.Mock).mock.calls[1][2][1].onPress(); });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('conversation/id', 'Pay me via Venmo', 'user-id');
    expect(notificationService.markAsRead).toHaveBeenCalledWith(['notification-id']);
    expect(onActionComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends ordinary quick replies without warning and prevents rapid duplicate sends', async () => {
    const ui = render(
      <NotificationActionSheet notification={messageNotification} currentUserId="user-id" onClose={jest.fn()} />
    );
    fireEvent.changeText(ui.getByLabelText('Quick reply message'), 'The camera is provided');
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send quick reply'));
      fireEvent.press(ui.getByLabelText('Send quick reply'));
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('keeps the quick reply draft when an approved send fails', async () => {
    (sendMessage as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const onClose = jest.fn();
    const ui = render(
      <NotificationActionSheet notification={messageNotification} currentUserId="user-id" onClose={onClose} />
    );
    fireEvent.changeText(ui.getByLabelText('Quick reply message'), 'Email me');
    fireEvent.press(ui.getByLabelText('Send quick reply'));
    await act(async () => { (Alert.alert as jest.Mock).mock.calls[0][2][1].onPress(); });
    expect(ui.getByLabelText('Quick reply message').props.value).toBe('Email me');
    expect(onClose).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith("Couldn't send", expect.any(String));
  });

  it('does not let an old confirmation send after the notification closes', async () => {
    const onClose = jest.fn();
    const ui = render(
      <NotificationActionSheet notification={messageNotification} currentUserId="user-id" onClose={onClose} />
    );
    fireEvent.changeText(ui.getByLabelText('Quick reply message'), 'Text me');
    fireEvent.press(ui.getByLabelText('Send quick reply'));
    ui.rerender(<NotificationActionSheet notification={null} currentUserId="user-id" onClose={onClose} />);
    await act(async () => {
      (Alert.alert as jest.Mock).mock.calls[0][2][1].onPress();
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each(['unmount', 'notification change'])('does not send a benign quick reply after %s', async change => {
    const ui = render(
      <NotificationActionSheet notification={messageNotification} currentUserId="user-id" onClose={jest.fn()} />
    );
    fireEvent.changeText(ui.getByLabelText('Quick reply message'), 'Thanks!');
    const pending = ui.getByLabelText('Send quick reply').props.onPress();
    if (change === 'unmount') ui.unmount();
    else ui.rerender(<NotificationActionSheet notification={null} currentUserId="user-id" onClose={jest.fn()} />);
    await act(async () => { await pending; });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('asks acceptance recipients to check the bounty without treating the notification as assignment', () => {
    const ui = render(
      <NotificationActionSheet notification={{ ...messageNotification, type: 'acceptance', category: 'marketplace', data: { bountyId: 'b1' } }}
        currentUserId="user-id" onClose={jest.fn()} />
    );
    expect(ui.getByText(messagingStrings.notificationAcceptance)).toBeTruthy();
    expect(mockAcceptRequest).not.toHaveBeenCalled();
    fireEvent.press(ui.getByText('View Bounty'));
    expect(push).toHaveBeenCalledWith('/bounty/b1?source=notification');
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
