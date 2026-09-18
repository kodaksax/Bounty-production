import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface MessageActionsProps {
  visible: boolean;
  onClose: () => void;
  /** Quote this message in the composer. Omit to hide the option. */
  onReply?: () => void;
  onPin: () => void;
  onCopy: () => void;
  onReport: () => void;
  onBlockUser?: () => void;
  isPinned?: boolean;
  showBlockOption?: boolean;
}

/**
 * Action sheet for message long-press actions
 */
export function MessageActions({
  visible,
  onClose,
  onReply,
  onPin,
  onCopy,
  onReport,
  onBlockUser,
  isPinned = false,
  showBlockOption = true,
}: MessageActionsProps) {
  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal={true}
    >
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close message actions"
      >
        <View style={styles.container}>
          <View
            style={styles.actionSheet}
            accessibilityRole="menu"
            accessibilityLabel="Message actions"
          >
            {onReply && (
              <>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleAction(onReply)}
                  accessibilityRole="button"
                  accessibilityLabel="Reply to message"
                  accessibilityHint="Quotes this message in your reply"
                >
                  <MaterialIcons name="reply" size={22} color="#9CA3AF" accessibilityElementsHidden={true} />
                  <Text style={styles.actionText}>Reply</Text>
                </TouchableOpacity>

                <View style={styles.divider} />
              </>
            )}

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleAction(onPin)}
              accessibilityRole="button"
              accessibilityLabel={isPinned ? 'Unpin message' : 'Pin message'}
              accessibilityHint={isPinned ? 'Removes the pinned message' : 'Pins this message'}
            >
              <MaterialIcons
                name="push-pin"
                size={22}
                color="#9CA3AF"
                accessibilityElementsHidden={true}
              />
              <Text style={styles.actionText}>{isPinned ? 'Unpin Message' : 'Pin Message'}</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleAction(onCopy)}
              accessibilityRole="button"
              accessibilityLabel="Copy message text"
              accessibilityHint="Copies message text to clipboard"
            >
              <MaterialIcons name="content-copy" size={22} color="#9CA3AF" accessibilityElementsHidden={true} />
              <Text style={styles.actionText}>Copy Text</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleAction(onReport)}
              accessibilityRole="button"
              accessibilityLabel="Report message"
              accessibilityHint="Reports this message"
            >
              <MaterialIcons name="flag" size={22} color="#fca5a5" accessibilityElementsHidden={true} />
              <Text style={[styles.actionText, styles.dangerText]}>Report Message</Text>
            </TouchableOpacity>

            {showBlockOption && onBlockUser && (
              <>
                <View style={styles.divider} />

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleAction(onBlockUser)}
                  accessibilityRole="button"
                  accessibilityLabel="Block user"
                  accessibilityHint="Blocks this user"
                >
                  <MaterialIcons name="block" size={22} color="#fca5a5" accessibilityElementsHidden={true} />
                  <Text style={[styles.actionText, styles.dangerText]}>Block User</Text>
                </TouchableOpacity>
              </>
            )}

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.actionButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              accessibilityHint="Closes message actions menu"
            >
              <MaterialIcons name="close" size={22} color="#9CA3AF" accessibilityElementsHidden={true} />
              <Text style={styles.actionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    padding: 16,
  },
  actionSheet: {
    backgroundColor: '#111827',
    borderRadius: 16,
    overflow: 'hidden',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 12,
  },
  actionText: {
    fontSize: 16,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  dangerText: {
    color: '#fca5a5',
  },
  divider: {
    height: 1,
    backgroundColor: '#374151',
    marginHorizontal: 20,
  },
});
