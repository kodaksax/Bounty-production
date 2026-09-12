import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { bountyRequestService } from 'lib/services/bounty-request-service';
import { capture as posthogCapture } from 'lib/posthog';
import { notificationService } from 'lib/services/notification-service';
import { resolveNotificationDeepLink } from 'lib/services/notification-deep-links';
import { sendMessage } from 'lib/services/supabase-messaging';
import { categoryForNotificationType, isBundled } from 'lib/config/notification-taxonomy';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import type { Notification } from 'lib/types';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal } from '../ui/app-modal';

interface NotificationActionSheetProps {
  notification: Notification | null;
  currentUserId: string | null;
  onClose: () => void;
  /** Fires after a successful action (accept/decline/reply) so the caller can refresh its list. */
  onActionComplete?: () => void;
}

/**
 * Rich in-app actions (Accept/Decline/Reply/View bounty/Withdraw), per the
 * product decision that these are in-app only (no native OS notification
 * action buttons). Built on AppModal's `variant="sheet"` — the house bottom
 * sheet system (docs/MODAL_ANIMATION_STANDARD.md).
 */
export function NotificationActionSheet({ notification, currentUserId, onClose, onActionComplete }: NotificationActionSheetProps) {
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [busy, setBusy] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const visible = !!notification;
  const category = notification ? (notification.category ?? categoryForNotificationType(notification.type)) : null;
  const bundled = notification ? isBundled(notification) : false;
  // Derived alongside category/bundled (both already null-safe) rather than
  // read inline in JSX, so a transient null `notification` during the sheet's
  // close animation can never reach a direct `.type` access.
  const viewButtonLabel = notification?.type === 'bounty_quality_nudge'
    ? 'Add Details'
    : category === 'marketplace' ? 'View Bounty'
    : category === 'messages' ? 'View Conversation'
    : 'View';

  const finishAndClose = async () => {
    if (notification) {
      await notificationService.markAsRead([notification.id]).catch(() => {});
    }
    setReplyText('');
    onActionComplete?.();
    onClose();
  };

  const handleView = () => {
    if (!notification) return;
    const action = resolveNotificationDeepLink({ type: notification.type, category: notification.category, data: notification.data });
    posthogCapture('notification_opened', {
      notification_type: notification.type,
      category: notification.category,
      bounty_id: notification.data?.bountyId ?? null,
      deep_link_kind: action.kind,
      surface: 'action_sheet',
    });
    onClose();
    if (action.kind === 'route') {
      router.push(action.path as any);
    } else if (action.kind === 'conversation') {
      router.push(`/tabs/messenger/${encodeURIComponent(action.conversationId)}` as any);
    }
  };

  const handleAccept = async () => {
    const requestId = notification?.data?.requestId;
    if (!requestId) return;
    setBusy('accept');
    try {
      await bountyRequestService.acceptRequest(requestId);
      posthogCapture('notification_action_completed', {
        notification_type: notification?.type,
        action: 'accept_application',
        bounty_id: notification?.data?.bountyId ?? null,
      });
      await finishAndClose();
    } catch (e) {
      console.error('[NotificationActionSheet] accept failed', e);
    } finally {
      setBusy(null);
    }
  };

  const handleDecline = async () => {
    const requestId = notification?.data?.requestId;
    if (!requestId) return;
    setBusy('decline');
    try {
      await bountyRequestService.rejectRequest(requestId);
      await finishAndClose();
    } catch (e) {
      console.error('[NotificationActionSheet] decline failed', e);
    } finally {
      setBusy(null);
    }
  };

  const handleReply = async () => {
    const conversationId = notification?.data?.conversationId;
    if (!conversationId || !currentUserId || !replyText.trim()) return;
    setBusy('reply');
    try {
      await sendMessage(conversationId, replyText.trim(), currentUserId);
      await finishAndClose();
    } catch (e) {
      console.error('[NotificationActionSheet] reply failed', e);
    } finally {
      setBusy(null);
    }
  };

  const handleWithdraw = () => {
    onClose();
    router.push('/tabs/bounty-app?screen=wallet' as any);
  };

  return (
    <AppModal visible={visible} onRequestClose={onClose} variant="sheet" contentStyle={s.modalContent} avoidKeyboard={false}>
      <KeyboardAvoidingView style={s.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <View style={s.handle} />
          {notification && (
            <>
              <Text style={s.title} numberOfLines={2}>{notification.title}</Text>
              <Text style={s.body} numberOfLines={4}>{notification.body}</Text>

              {category === 'marketplace' && !bundled && notification.data?.requestId ? (
                <View style={s.actionRow}>
                  <TouchableOpacity style={[s.actionButton, s.declineButton]} onPress={handleDecline} disabled={!!busy}>
                    {busy === 'decline' ? <ActivityIndicator color={theme.error} /> : <Text style={s.declineText}>Decline</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.actionButton, s.acceptButton]} onPress={handleAccept} disabled={!!busy}>
                    {busy === 'accept' ? <ActivityIndicator color="#fff" /> : <Text style={s.acceptText}>Accept</Text>}
                  </TouchableOpacity>
                </View>
              ) : null}

              {category === 'messages' && !bundled && notification.data?.conversationId ? (
                <View style={s.replyRow}>
                  <TextInput
                    style={s.replyInput}
                    placeholder="Type a reply..."
                    placeholderTextColor={theme.textDisabled}
                    value={replyText}
                    onChangeText={setReplyText}
                    multiline
                  />
                  <TouchableOpacity
                    style={[s.sendButton, !replyText.trim() && s.sendButtonDisabled]}
                    onPress={handleReply}
                    disabled={!replyText.trim() || !!busy}
                  >
                    {busy === 'reply' ? <ActivityIndicator color="#fff" /> : <MaterialIcons name="send" size={18} color="#fff" />}
                  </TouchableOpacity>
                </View>
              ) : null}

              {category === 'payments' ? (
                <TouchableOpacity style={[s.actionButton, s.primaryButton, s.fullWidth]} onPress={handleWithdraw}>
                  <Text style={s.primaryText}>Manage Payouts</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity style={s.viewButton} onPress={handleView}>
                <Text style={s.viewText}>{viewButtonLabel}</Text>
                <MaterialIcons name="chevron-right" size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </AppModal>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    modalContent: { flex: 1, width: '100%' },
    keyboardAvoider: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 32,
      borderWidth: 1,
      borderColor: t.border,
      borderBottomWidth: 0,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.border,
      marginBottom: 16,
    },
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: t.text,
      marginBottom: 6,
    },
    body: {
      fontSize: 14,
      lineHeight: 19,
      color: t.textSecondary,
      marginBottom: 18,
    },
    actionRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 12,
    },
    actionButton: {
      flex: 1,
      height: 46,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fullWidth: { flex: undefined, marginBottom: 12 },
    declineButton: {
      backgroundColor: t.isDark ? 'rgba(239,68,68,0.16)' : 'rgba(239,68,68,0.1)',
    },
    declineText: { color: t.error, fontWeight: '700', fontSize: 15 },
    acceptButton: { backgroundColor: t.primary },
    acceptText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    primaryButton: { backgroundColor: t.primary },
    primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    replyRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 10,
      marginBottom: 12,
    },
    replyInput: {
      flex: 1,
      minHeight: 44,
      maxHeight: 100,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceSecondary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: t.text,
      fontSize: 14,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.primary,
    },
    sendButtonDisabled: { opacity: 0.5 },
    viewButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
    },
    viewText: { color: t.textSecondary, fontWeight: '600', fontSize: 14, marginRight: 2 },
  });
}
