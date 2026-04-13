'use client';

import { MaterialIcons } from '@expo/vector-icons';
import { Avatar, AvatarFallback, AvatarImage } from 'components/ui/avatar';
import { useRouter } from 'expo-router';
import React, { useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageActions } from '../../components/MessageActions';
import { MessageBubble } from '../../components/MessageBubble';
import { PinnedMessageHeader } from '../../components/PinnedMessageHeader';
import { ReportModal } from '../../components/ReportModal';
import { generateInitials } from '../../lib/services/supabase-messaging';
import type { FullConversation, Message } from '../../lib/types';
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile';
import { useMessages } from '../../hooks/useMessages';
import { getCurrentUserId } from '../../lib/utils/data-utils';

interface ChatDetailScreenProps {
  conversation: FullConversation;
  onBack?: () => void;
}

export function FullChatDetailScreen({ conversation, onBack }: ChatDetailScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const BOTTOM_NAV_OFFSET = Math.max(96, (insets.bottom || 0) + 12);

  const currentUserId = getCurrentUserId();

  // Use the real conversation ID for Supabase operations
  const targetConversationId = conversation.realConversationId || conversation.id;

  // Replace manual state + messageService with useMessages hook (same as ChatDetailScreen)
  const {
    messages,
    loading,
    error,
    pinnedMessage,
    sendMessage,
    pinMessage,
    unpinMessage,
    copyMessage,
  } = useMessages(targetConversationId);

  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList<Message>>(null);

  // 1:1 chat profile
  const otherUserId =
    !conversation.isGroup && conversation.participantIds
      ? conversation.participantIds.find(id => id !== currentUserId)
      : null;

  const { profile: otherUserProfile } = useNormalizedProfile(otherUserId || undefined);

  const displayName =
    !conversation.isGroup && otherUserProfile?.username
      ? otherUserProfile.username
      : conversation.name;

  const avatarUrl =
    !conversation.isGroup && otherUserProfile?.avatar
      ? otherUserProfile.avatar
      : conversation.avatar;

  const initials = generateInitials(otherUserProfile?.username, otherUserProfile?.name);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || sending) return;

    setSending(true);
    try {
      // useMessages.sendMessage → supabaseMessaging.sendMessage → real Supabase insert
      await sendMessage(text);
      setInputText('');
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err: any) {
      Alert.alert('Failed to send', err.message || 'Something went wrong');
    } finally {
      setSending(false);
    }
  };

  const handleLongPress = useCallback((messageId: string) => {
    setSelectedMessageId(messageId);
    setShowActions(true);
  }, []);

  const handlePin = async () => {
    if (!selectedMessageId) return;
    const message = messages.find(m => m.id === selectedMessageId);
    if (message?.isPinned) {
      await unpinMessage(selectedMessageId);
    } else {
      await pinMessage(selectedMessageId);
    }
  };

  const handleCopy = async () => {
    if (!selectedMessageId) return;
    await copyMessage(selectedMessageId);
    Alert.alert('Copied', 'Message copied to clipboard');
  };

  const handlePinnedMessagePress = () => {
    if (!pinnedMessage) return;
    const index = messages.findIndex(m => m.id === pinnedMessage.id);
    if (index !== -1) {
      listRef.current?.scrollToIndex({ index, animated: true });
    }
  };

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => (
      <MessageBubble
        id={item.id}
        text={item.text}
        isUser={item.senderId === currentUserId}
        status={item.status}
        isPinned={item.isPinned}
        onLongPress={() => handleLongPress(item.id)}
      />
    ),
    [currentUserId, handleLongPress]
  );

  const trimmedInputText = inputText.trim();

  return (
    <View style={[styles.container, { paddingBottom: BOTTOM_NAV_OFFSET + 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#064E3B" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (otherUserId && !conversation.isGroup) {
                router.push(`/profile/${otherUserId}`);
              }
            }}
            disabled={!otherUserId || conversation.isGroup}
            style={styles.headerProfile}
          >
            <Avatar style={styles.headerAvatar}>
              <AvatarImage src={avatarUrl || '/placeholder.svg?height=40&width=40'} alt={displayName} />
              <AvatarFallback style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>{initials}</Text>
              </AvatarFallback>
            </Avatar>
            <View>
              <Text style={styles.headerName}>{displayName}</Text>
              {conversation.isGroup && (
                <Text style={styles.headerSubtext}>
                  {conversation.participantIds.length} members
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Pinned Message Header */}
      {pinnedMessage && (
        <PinnedMessageHeader
          text={pinnedMessage.text}
          onPress={handlePinnedMessagePress}
          onDismiss={() => unpinMessage(pinnedMessage.id)}
        />
      )}

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Messages and Input */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={BOTTOM_NAV_OFFSET}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#059669" />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <FlatList
              ref={listRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.messageList}
              onScrollToIndexFailed={(info) => {
                const wait = new Promise(resolve => setTimeout(resolve, 500));
                wait.then(() => {
                  listRef.current?.scrollToIndex({ index: info.index, animated: true });
                });
              }}
            />

            {/* Input */}
            <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom || 0, 8) }]}>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.inlineTextInput}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Type a message..."
                  placeholderTextColor="#9CA3AF"
                  multiline
                  editable={!sending}
                  accessibilityLabel="Message input field"
                />
                <TouchableOpacity
                  style={[styles.sendButton, (!trimmedInputText || sending) && styles.sendButtonDisabled]}
                  onPress={() => handleSendMessage(trimmedInputText)}
                  disabled={!trimmedInputText || sending}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#059669" />
                  ) : (
                    <MaterialIcons name="send" size={20} color="#059669" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Message Actions */}
      <MessageActions
        visible={showActions}
        onClose={() => setShowActions(false)}
        onPin={handlePin}
        onCopy={handleCopy}
        onReport={() => {
          setShowActions(false);
          setShowReportModal(true);
        }}
        isPinned={messages.find(m => m.id === selectedMessageId)?.isPinned}
      />

      {/* Report Modal */}
      <ReportModal
        visible={showReportModal}
        onClose={() => {
          setShowReportModal(false);
          setSelectedMessageId(null);
        }}
        contentType="message"
        contentId={selectedMessageId || ''}
        contentTitle="Message"
      />
    </View>
  );
}

export default FullChatDetailScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  headerInner: { flexDirection: 'row', alignItems: 'center' },
  backButton: { marginRight: 12 },
  headerProfile: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  avatarFallback: {
    backgroundColor: '#D1FAE5',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallbackText: { color: '#064E3B', fontWeight: '600', fontSize: 14 },
  headerName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  headerSubtext: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
  },
  errorText: { fontSize: 13, color: '#991B1B' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 16 },
  inputContainer: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F9FAFB',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inlineTextInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    maxHeight: 100,
    paddingVertical: 4,
  },
  sendButton: { marginLeft: 8, padding: 4, alignSelf: 'flex-end' },
  sendButtonDisabled: { opacity: 0.4 },
});