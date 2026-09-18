import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { memo, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cn } from '../lib/utils';
import { getMediaKind, isEmojiOnly, mediaFileName, mediaPreviewLabel } from '../lib/utils/message-media';

/**
 * Every text size in a message bubble, in one place. Change these to resize
 * chat text; the styles below and the message body read from here.
 */
export const MESSAGE_FONT_SIZE = {
  /** The message text itself */
  body: 18,
  /** Emoji-only messages, drawn large with no bubble */
  emojiOnly: 44,
  /** "Replying to" sender name inside a reply quote */
  quoteSender: 11,
  /** Quoted text inside a reply quote */
  quoteText: 12,
  /** "Pinned" badge */
  pinnedBadge: 10,
  /** File name on a non-previewable attachment chip */
  fileName: 13,
  /** "Retry" under a failed message */
  retry: 12,
} as const;

/** The message a reply quotes, resolved by the screen from the thread. */
export interface QuotedMessage {
  id: string;
  /** "You" or the sender's display name. */
  senderLabel: string;
  text: string;
  mediaUrl?: string | null;
}

export interface MessageBubbleProps {
  id: string;
  text: string;
  isUser: boolean;
  /** Public URL of an attached image / video / document, when the message has one */
  mediaUrl?: string | null;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  isPinned?: boolean;
  /**
   * The message this one replies to, when its original is still available in
   * the loaded thread.
   */
  replyTo?: QuotedMessage;
  /** Briefly emphasised after the viewer jumps here from a reply's quote. */
  isHighlighted?: boolean;
  onLongPress?: (messageId: string) => void;
  /** Called with the quoted message's id when the quote block is tapped */
  onReplyPress?: (messageId: string) => void;
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
  replyTo,
  isHighlighted,
  onLongPress,
  onRetry,
  onMediaPress,
  onReplyPress
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

  // Quote of the message being replied to. The accent bar on its left edge is
  // the visual "points at" cue; tapping it jumps the thread to the original.
  const renderQuote = () => {
    if (!replyTo) return null;

    const preview = replyTo.text.trim() || mediaPreviewLabel(replyTo.mediaUrl);

    return (
      <TouchableOpacity
        style={[styles.quote, isUser ? styles.quoteUser : styles.quoteOther]}
        onPress={() => onReplyPress?.(replyTo.id)}
        onLongPress={handleLongPress}
        disabled={!onReplyPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Replying to ${replyTo.senderLabel}: ${preview}`}
        accessibilityHint="Jumps to the original message"
      >
        <View style={[styles.quoteBar, isUser ? styles.quoteBarUser : styles.quoteBarOther]} />
        <View style={styles.quoteBody}>
          <View style={styles.quoteHeader}>
            <MaterialIcons name="reply" size={12} color={isUser ? '#d1fae5' : '#6ee7b7'} />
            <Text
              style={[styles.quoteSender, isUser ? styles.quoteSenderUser : styles.quoteSenderOther]}
              numberOfLines={1}
            >
              {replyTo.senderLabel}
            </Text>
          </View>
          <Text
            style={styles.quoteText}
            numberOfLines={2}
          >
            {preview}
          </Text>
        </View>
      </TouchableOpacity>
    );
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

  // An emoji-only reply still needs its quote, so it keeps the bubble layout.
  if (jumboEmoji && replyTo === undefined) {
    return (
      <TouchableOpacity activeOpacity={0.8} onLongPress={handleLongPress} delayLongPress={500}>
        <View
          className={cn('mb-3 px-3 max-w-[80%]', isUser ? 'ml-auto' : 'mr-auto')}
          style={isHighlighted ? styles.highlighted : undefined}
        >
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
      <View
        className={cn('mb-3 px-3 max-w-[80%]', isUser ? 'ml-auto' : 'mr-auto')}
        style={isHighlighted ? styles.highlighted : undefined}
      >
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
          {renderQuote()}
          {renderMedia()}
          {/* Attachment-only messages carry empty text — don't render an empty
              Text node, which would add a stray blank line under the image. */}
          {hasText && <Text style={styles.body}>{text}</Text>}
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
  body: {
    fontSize: MESSAGE_FONT_SIZE.body,
    lineHeight: Math.round(MESSAGE_FONT_SIZE.body * 1.45),
    color: '#FFFFFF',
  },
  highlighted: {
    borderRadius: 18,
    backgroundColor: 'rgba(110, 231, 183, 0.18)',
  },
  quote: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 6,
    maxWidth: 240,
  },
  quoteUser: {
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  quoteOther: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  quoteBar: {
    width: 3,
    alignSelf: 'stretch',
  },
  quoteBarUser: {
    backgroundColor: '#d1fae5',
  },
  quoteBarOther: {
    backgroundColor: '#6ee7b7',
  },
  quoteBody: {
    flexShrink: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 2,
  },
  quoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  quoteSender: {
    fontSize: MESSAGE_FONT_SIZE.quoteSender,
    fontWeight: '700',
  },
  quoteSenderUser: {
    color: '#d1fae5',
  },
  quoteSenderOther: {
    color: '#6ee7b7',
  },
  quoteText: {
    fontSize: MESSAGE_FONT_SIZE.quoteText,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  quoteTextUnavailable: {
    fontStyle: 'italic',
    color: 'rgba(255, 255, 255, 0.6)',
  },
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
    fontSize: MESSAGE_FONT_SIZE.pinnedBadge,
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
    fontSize: MESSAGE_FONT_SIZE.fileName,
    color: '#E5E7EB',
  },
  jumboEmoji: {
    fontSize: MESSAGE_FONT_SIZE.emojiOnly,
    lineHeight: Math.round(MESSAGE_FONT_SIZE.emojiOnly * 1.23),
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
    fontSize: MESSAGE_FONT_SIZE.retry,
    color: '#ef4444',
    fontWeight: '600',
  },
});
