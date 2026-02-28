import { MaterialIcons } from '@expo/vector-icons';
import type { Attachment } from 'lib/types';
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AttachmentViewerModal } from '../attachment-viewer-modal';

import { colors } from '../../lib/theme';
interface AttachmentsListProps {
  attachments: Attachment[];
  onAttachmentPress?: (attachment: Attachment) => void;
}

/**
 * List component to display bounty attachments with file info.
 * Shows thumbnails for images or file icons for other types.
 * Includes integrated viewer modal for viewing and downloading attachments.
 */
export function AttachmentsList({ attachments, onAttachmentPress }: AttachmentsListProps) {
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);

  const handleAttachmentPress = (attachment: Attachment) => {
    if (onAttachmentPress) {
      // If custom handler provided, use it
      onAttachmentPress(attachment);
    } else {
      // Otherwise, open in viewer modal
      setSelectedAttachment(attachment);
      setViewerVisible(true);
    }
  };

  const handleCloseViewer = () => {
    setViewerVisible(false);
    setSelectedAttachment(null);
  };
  if (!attachments || attachments.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <MaterialIcons name="attach-file" size={24} color="rgba(110,231,183,0.4)" />
        <Text style={styles.emptyText}>No attachments</Text>
      </View>
    );
  }

  const getFileIcon = (mimeType?: string): string => {
    if (!mimeType) return 'insert-drive-file';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'videocam';
    if (mimeType.startsWith('audio/')) return 'audiotrack';
    if (mimeType.includes('pdf')) return 'picture-as-pdf';
    return 'insert-drive-file';
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderAttachment = ({ item }: { item: Attachment }) => {
    const mimeType = item.mime || item.mimeType;
    const icon = getFileIcon(mimeType);
    const sizeText = formatFileSize(item.size);

    return (
      <TouchableOpacity
        style={styles.attachmentItem}
        onPress={() => handleAttachmentPress(item)}
        accessibilityRole="button"
        accessibilityLabel={`Attachment: ${item.name}, ${sizeText}`}
      >
        <View style={styles.iconContainer}>
          <MaterialIcons name={icon as any} size={24} color={colors.primary[500]} />
        </View>
        <View style={styles.attachmentInfo}>
          <Text style={styles.attachmentName} numberOfLines={1}>
            {item.name}
          </Text>
          {sizeText && <Text style={styles.attachmentSize}>{sizeText}</Text>}
        </View>
        {item.status === 'uploading' && (
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>Uploading...</Text>
          </View>
        )}
        {item.status === 'failed' && (
          <MaterialIcons name="error-outline" size={20} color="#ef4444" />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <>
      <View style={styles.container}>
        <Text style={styles.label}>Attachments</Text>
        <View style={styles.listContent}>
          {attachments.map((att) => (
            <View key={att.id}>{renderAttachment({ item: att })}</View>
          ))}
        </View>
      </View>

      {/* Attachment Viewer Modal */}
      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={selectedAttachment}
        onClose={handleCloseViewer}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  label: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    gap: 8,
  },
  emptyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.1)',
    borderStyle: 'dashed',
  },
  emptyText: {
    color: 'rgba(110,231,183,0.6)',
    fontSize: 14,
    fontStyle: 'italic',
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentInfo: {
    flex: 1,
  },
  attachmentName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  attachmentSize: {
    color: '#6ee7b7',
    fontSize: 12,
    marginTop: 2,
  },
  statusContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 4,
  },
  statusText: {
    color: '#6ee7b7',
    fontSize: 10,
    fontWeight: '600',
  },
});
