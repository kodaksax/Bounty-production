import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

interface OfflineStatusBadgeProps {
  onPress?: () => void;
}

export function OfflineStatusBadge({ onPress }: OfflineStatusBadgeProps) {
  const { pendingCount, failedCount, isOnline, queue, retryItem, removeItem, clearFailedItems } = useOfflineQueue();
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
        style={[styles.container, { backgroundColor }]}
        activeOpacity={0.7}
      >
        <View style={styles.content}>
          <MaterialIcons name={icon} size={16} color="#fff" style={styles.icon} />
          <Text style={styles.text}>
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
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Offline Queue</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <MaterialIcons name="close" size={20} color="#374151" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.queueList}>
              {/**
               * `queue` can be undefined in some test mocks; default to empty array
               * to avoid runtime errors when reading `length` or mapping.
               */}
              {(() => {
                const safeQueue = queue ?? [];
                if (safeQueue.length === 0) {
                  return <Text style={styles.emptyText}>No queued actions</Text>;
                }

                return safeQueue.map(item => (
                  <View key={item.id} style={styles.queueItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{item.type.toUpperCase()} • {item.status}</Text>
                      <Text style={styles.itemMeta}>{new Date(item.timestamp).toLocaleString()}</Text>
                      {item.error ? <Text style={styles.itemError}>{item.error}</Text> : null}
                    </View>

                    <View style={styles.itemActions}>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => retryItem(item.id)}>
                        <MaterialIcons name="refresh" size={18} color="#065f46" />
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, { marginLeft: 8 }]} onPress={() => removeItem(item.id)}>
                        <MaterialIcons name="delete" size={18} color="#b91c1c" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ));
              })()}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.clearBtn} onPress={async () => { await clearFailedItems(); }}>
                <Text style={styles.clearText}>Clear Failed</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.closeText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: '#fff',
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
    color: '#111827',
    fontWeight: '700',
  },
  queueList: {
    maxHeight: 320,
  },
  emptyText: {
    color: '#6b7280',
    textAlign: 'center',
    padding: 12,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  itemMeta: {
    fontSize: 12,
    color: '#6b7280',
  },
  itemError: {
    marginTop: 4,
    color: '#b91c1c',
    fontSize: 12,
  },
  itemActions: {
    marginLeft: 12,
    flexDirection: 'row',
  },
  actionBtn: {
    backgroundColor: '#ecfeff',
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
    backgroundColor: '#fee2e2',
    borderRadius: 8,
  },
  clearText: {
    color: '#b91c1c',
    fontWeight: '600',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#e6fffa',
    borderRadius: 8,
    marginLeft: 8,
  },
  closeText: {
    color: '#065f46',
    fontWeight: '600',
  },
});
