import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface MessageActionsProps {
  visible: boolean;
  onClose: () => void;
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
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => handleAction(onPin)}
              accessibilityRole="button"
              accessibilityLabel={isPinned ? 'Unpin message' : 'Pin message'}
              accessibilityHint={isPinned ? 'Removes message from pinned messages' : 'Pins message to top of conversation'}
            >
              <MaterialIcons 
                name={isPinned ? 'push-pin' : 'push-pin'} 
                size={22} 
                color={isPinned ? '#fbbf24' : '#d1fae5'} 
                accessibilityElementsHidden={true}
              />
              <Text style={styles.actionText}>
                {isPinned ? 'Unpin Message' : 'Pin Message'}
              </Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => handleAction(onCopy)}
              accessibilityRole="button"
              accessibilityLabel="Copy message text"
              accessibilityHint="Copies message text to clipboard"
            >
              <MaterialIcons name="content-copy" size={22} color="#d1fae5" accessibilityElementsHidden={true} />
              <Text style={styles.actionText}>Copy Text</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => handleAction(onReport)}
              accessibilityRole="button"
              accessibilityLabel="Report message"
              accessibilityHint="Reports this message for review"
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
                  accessibilityLabel="Block this user"
                  accessibilityHint="Block this user to prevent them from contacting you"
                >
                  <MaterialIcons name="block" size={22} color="#fca5a5" />
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
              <MaterialIcons name="close" size={22} color="#d1fae5" accessibilityElementsHidden={true} />
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
    backgroundColor: '#065f46', // emerald-800
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
    color: '#d1fae5', // emerald-200
    fontWeight: '500',
  },
  dangerText: {
    color: '#fca5a5', // red-300
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    marginHorizontal: 20,
  },
});
