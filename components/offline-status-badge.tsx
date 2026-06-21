import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

interface OfflineStatusBadgeProps {
  onPress?: () => void;
}

export function OfflineStatusBadge({ onPress }: OfflineStatusBadgeProps) {
  const { pendingCount, failedCount, isOnline, queue, retryItem, removeItem, clearFailedItems } = useOfflineQueue();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [showModal, setShowModal] = useState(false);

  // Don't show if online and no pending/failed items
  if (isOnline && pendingCount === 0 && failedCount === 0) {
    return null;
  }

  const hasFailures = failedCount > 0;
  const backgroundColor = hasFailures ? '#dc2626' : '#f59e0b';
  const icon = hasFailures ? 'error-outline' : isOnline ? 'sync' : 'cloud-off';

  return (
    <>
      <TouchableOpacity 
        onPress={() => { setShowModal(true); onPress?.(); }}
        style={[s.container, { backgroundColor }]}
        activeOpacity={0.7}
      >
        <View style={s.content}>
          <MaterialIcons name={icon} size={16} color="#fff" style={s.icon} />
          <Text style={s.text}>
            {hasFailures 
              ? `${failedCount} failed`
              : isOnline 
                ? `${pendingCount} syncing...`
                : `${pendingCount} pending`
            }
          </Text>
        </View>
      </TouchableOpacity>

      <Modal visible={showModal} animationType="slide" transparent={true} onRequestClose={() => setShowModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalContainer}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Offline Queue</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <MaterialIcons name="close" size={20} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.queueList}>
              {/**
               * `queue` can be undefined in some test mocks; default to empty array
               * to avoid runtime errors when reading `length` or mapping.
               */}
              {(() => {
                const safeQueue = queue ?? [];
                if (safeQueue.length === 0) {
                  return <Text style={s.emptyText}>No queued actions</Text>;
                }

                return safeQueue.map(item => (
                  <View key={item.id} style={s.queueItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemTitle}>{item.type.toUpperCase()} • {item.status}</Text>
                      <Text style={s.itemMeta}>{new Date(item.timestamp).toLocaleString()}</Text>
                      {item.error ? <Text style={s.itemError}>{item.error}</Text> : null}
                    </View>

                    <View style={s.itemActions}>
                      <TouchableOpacity style={s.actionBtn} onPress={() => retryItem(item.id)}>
                        <MaterialIcons name="refresh" size={18} color={theme.text} />
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.actionBtn, { marginLeft: 8 }]} onPress={() => removeItem(item.id)}>
                        <MaterialIcons name="delete" size={18} color="#b91c1c" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ));
              })()}
            </ScrollView>

            <View style={s.modalFooter}>
              <TouchableOpacity style={s.clearBtn} onPress={async () => { await clearFailedItems(); }}>
                <Text style={s.clearText}>Clear Failed</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.closeBtn} onPress={() => setShowModal(false)}>
                <Text style={s.closeText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    // White text on semantic-colored (red/amber) badge — always white
    text: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '600',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContainer: {
      width: '90%',
      maxHeight: '80%',
      backgroundColor: t.surface,
      borderRadius: 12,
      padding: 12,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    modalTitle: {
      fontSize: 16,
      color: t.text,
      fontWeight: '700',
    },
    queueList: {
      maxHeight: 320,
    },
    emptyText: {
      color: t.textSecondary,
      textAlign: 'center',
      padding: 12,
    },
    queueItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    itemTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: t.text,
    },
    itemMeta: {
      fontSize: 12,
      color: t.textSecondary,
    },
    itemError: {
      marginTop: 4,
      color: '#b91c1c',     // semantic red — preserved
      fontSize: 12,
    },
    itemActions: {
      marginLeft: 12,
      flexDirection: 'row',
    },
    actionBtn: {
      backgroundColor: t.surfaceSecondary,
      padding: 6,
      borderRadius: 6,
    },
    modalFooter: {
      marginTop: 12,
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    icon: {
      marginRight: 6,
    },
    clearBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: 'rgba(239,68,68,0.12)',  // semantic red tint — preserved
      borderRadius: 8,
    },
    clearText: {
      color: '#b91c1c',     // semantic red — preserved
      fontWeight: '600',
    },
    closeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: t.surfaceSecondary,
      borderRadius: 8,
      marginLeft: 8,
    },
    closeText: {
      color: t.text,
      fontWeight: '600',
    },
  });
}
