import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { memo, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cn } from '../lib/utils';
import { getMediaKind, isEmojiOnly, mediaFileName } from '../lib/utils/message-media';

export interface MessageBubbleProps {
  id: string;
  text: string;
  isUser: boolean;
  /** Public URL of an attached image / video / document, when the message has one */
  mediaUrl?: string | null;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  isPinned?: boolean;
  onLongPress?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  /** Called with the media URL when the attachment is tapped (opens the viewer) */
  onMediaPress?: (mediaUrl: string) => void;
}

/**
 * Individual message bubble with attachment rendering, status indicators and
 * long-press support.
 */
export const MessageBubble = memo(({ 
  id,
  text, 
  isUser, 
  mediaUrl,
  status,
  isPinned,
  onLongPress,
  onRetry,
  onMediaPress
}: MessageBubbleProps) => {
  const [mediaFailed, setMediaFailed] = useState(false);

  const handleLongPress = () => {
    if (onLongPress) {
      onLongPress(id);
    }
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry(id);
    }
  };

  const handleMediaPress = () => {
    if (mediaUrl && onMediaPress) {
      onMediaPress(mediaUrl);
    }
  };

  const mediaKind = useMemo(() => (mediaUrl ? getMediaKind(mediaUrl) : null), [mediaUrl]);
  const hasText = text.trim().length > 0;
  // Emoji-only messages render large and without a bubble, the way every other
  // chat app does it.
  const jumboEmoji = hasText && !mediaUrl && isEmojiOnly(text);

  const renderStatusIcon = () => {
    if (!isUser || !status) return null;

    switch (status) {
      case 'sending':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="schedule" size={12} color="rgba(156, 163, 175, 0.6)" />
          </View>
        );
      case 'sent':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="check" size={12} color="#9CA3AF" />
          </View>
        );
      case 'delivered':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="done-all" size={12} color="#9CA3AF" />
          </View>
        );
      case 'read':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="done-all" size={12} color="#60a5fa" />
          </View>
        );
      case 'failed':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="error" size={12} color="#ef4444" />
          </View>
        );
      default:
        return null;
    }
  };

  const renderMedia = () => {
    if (!mediaUrl) return null;

    // Broken/expired URL, or a document the platform can't thumbnail: show a
    // tappable file chip rather than a blank space.
    if (mediaFailed || mediaKind === 'file') {
      return (
        <TouchableOpacity
          style={styles.fileChip}
          onPress={handleMediaPress}
          onLongPress={handleLongPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Open attachment ${mediaFileName(mediaUrl)}`}
        >
          <MaterialIcons
            name={mediaFailed ? 'broken-image' : 'insert-drive-file'}
            size={20}
            color="#E5E7EB"
          />
          <Text style={styles.fileChipText} numberOfLines={1}>
            {mediaFileName(mediaUrl)}
          </Text>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        onPress={handleMediaPress}
        onLongPress={handleLongPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={mediaKind === 'video' ? 'Open video attachment' : 'Open image attachment'}
      >
        <View style={[styles.mediaWrapper, hasText && styles.mediaWrapperWithText]}>
          <Image
            source={{ uri: mediaUrl }}
            style={styles.media}
            contentFit="cover"
            transition={120}
            onError={() => setMediaFailed(true)}
            accessibilityIgnoresInvertColors
          />
          {status === 'sending' && (
            <View style={styles.mediaOverlay}>
              <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
          )}
          {mediaKind === 'video' && status !== 'sending' && (
            <View style={styles.playOverlay}>
              <MaterialIcons name="play-arrow" size={28} color="#FFFFFF" />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (jumboEmoji) {
    return (
      <TouchableOpacity activeOpacity={0.8} onLongPress={handleLongPress} delayLongPress={500}>
        <View className={cn('mb-3 px-3 max-w-[80%]', isUser ? 'ml-auto' : 'mr-auto')}>
          {isPinned && (
            <View style={styles.pinnedBadge}>
              <MaterialIcons name="push-pin" size={12} color="#fbbf24" />
              <Text style={styles.pinnedText}>Pinned</Text>
            </View>
          )}
          <Text style={[styles.jumboEmoji, isUser ? styles.jumboEmojiUser : null]}>
            {text.trim()}
          </Text>
          {renderStatusIcon()}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onLongPress={handleLongPress}
      delayLongPress={500}
    >
      <View className={cn('mb-3 px-3 max-w-[80%]', isUser ? 'ml-auto' : 'mr-auto')}>
        <View className={cn(
          'px-3 py-2 rounded-2xl',
          isUser
            ? 'bg-[#059669] rounded-br-none'
            : 'bg-[#1F2937] rounded-bl-none'
        )}>
          {isPinned && (
            <View style={styles.pinnedBadge}>
              <MaterialIcons name="push-pin" size={12} color="#fbbf24" />
              <Text style={styles.pinnedText}>Pinned</Text>
            </View>
          )}
          {renderMedia()}
          {/* Attachment-only messages carry empty text — don't render an empty
              Text node, which would add a stray blank line under the image. */}
          {hasText && (
            <Text className={cn(
              'text-sm',
              isUser ? 'text-white' : 'text-white'
            )}>{text}</Text>
          )}
          {renderStatusIcon()}
        </View>
        {/* Retry button for failed messages */}
        {status === 'failed' && isUser && onRetry && (
          <TouchableOpacity 
            onPress={handleRetry}
            style={styles.retryButton}
            activeOpacity={0.7}
          >
            <MaterialIcons name="refresh" size={16} color="#ef4444" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
});

MessageBubble.displayName = 'MessageBubble';

const styles = StyleSheet.create({
  statusContainer: {
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  pinnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  pinnedText: {
    fontSize: 10,
    color: '#fbbf24',
    fontWeight: '600',
  },
  mediaWrapper: {
    width: 220,
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  mediaWrapperWithText: {
    marginBottom: 6,
  },
  media: {
    width: '100%',
    height: '100%',
  },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    maxWidth: 220,
    marginBottom: 2,
  },
  fileChipText: {
    flexShrink: 1,
    fontSize: 13,
    color: '#E5E7EB',
  },
  jumboEmoji: {
    fontSize: 44,
    lineHeight: 54,
  },
  jumboEmojiUser: {
    textAlign: 'right',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
    alignSelf: 'flex-end',
  },
  retryText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '600',
  },
});
