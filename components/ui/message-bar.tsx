import { MaterialIcons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

interface MessageBarProps {
  conversationId: string | null;
  onSendMessage: (text: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Message bar component for quick messaging within a bounty context.
 * Handles sending messages with loading state and error feedback.
 */
export function MessageBar({
  conversationId,
  onSendMessage,
  placeholder = 'Type a message...',
  disabled = false,
}: MessageBarProps) {
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const handleSend = async () => {
    const trimmed = messageText.trim();
    if (!trimmed) return;

    if (!conversationId) {
      Alert.alert('No Conversation', 'No active conversation found for this bounty.');
      return;
    }

    try {
      setIsSending(true);
      await onSendMessage(trimmed);
      setMessageText('');
    } catch (err) {
      console.error('Error sending message:', err);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const canSend = !disabled && !isSending && messageText.trim().length > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Quick Message</Text>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={theme.textDisabled}
          value={messageText}
          onChangeText={setMessageText}
          multiline
          maxLength={500}
          editable={!disabled && !isSending}
          accessibilityLabel="Message input"
          accessibilityHint="Type your message here"
        />
        <TouchableOpacity
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons name="send" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      gap: 8,
    },
    label: {
      color: theme.primaryLight,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    inputContainer: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-end',
    },
    input: {
      flex: 1,
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      padding: 12,
      color: theme.text,
      fontSize: 14,
      minHeight: 48,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: theme.border,
      textAlignVertical: 'top',
    },
    sendButton: {
      backgroundColor: '#059669',
      width: 48,
      height: 48,
      borderRadius: 24,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendButtonDisabled: {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : theme.border,
    },
  });
}
