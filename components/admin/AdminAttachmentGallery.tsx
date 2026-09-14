// components/admin/AdminAttachmentGallery.tsx — photos and files on a listing,
// as a moderator needs to see them: images as tappable thumbnails, anything
// else as a named row, both opening the shared full-screen viewer.
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../../hooks/use-app-theme';
import { isImageAttachment, type ParsedBountyAttachments } from '../../lib/admin/bounty-attachments';
import type { Attachment } from '../../lib/types';
import { AttachmentViewerModal } from '../attachment-viewer-modal';
import { AdminPanel } from './AdminUI';

const THUMB_SIZE = 96;

export function AdminAttachmentGallery({
  attachments,
  isLoading = false,
}: {
  attachments: ParsedBountyAttachments | null;
  isLoading?: boolean;
}) {
  const { theme } = useAppTheme();
  const [selected, setSelected] = useState<Attachment | null>(null);

  const viewable = attachments?.viewable ?? [];
  const unavailable = attachments?.unavailableCount ?? 0;
  const images = viewable.filter(isImageAttachment);
  const files = viewable.filter((a) => !isImageAttachment(a));

  const note = (text: string) => (
    <Text style={{ color: theme.textSecondary, fontSize: theme.typography.fontSize.sm }}>{text}</Text>
  );

  return (
    <AdminPanel style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
      {isLoading ? note('Loading attachments…') : null}
      {!isLoading && viewable.length === 0 && unavailable === 0 ? note('No photos or files were attached.') : null}

      {images.length > 0 ? (
        <View style={styles.grid}>
          {images.map((image) => (
            <TouchableOpacity
              key={image.id}
              onPress={() => setSelected(image)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`View ${image.name}`}
              style={[styles.thumb, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}
            >
              <Image source={{ uri: image.remoteUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {files.map((file) => (
        <TouchableOpacity
          key={file.id}
          onPress={() => setSelected(file)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${file.name}`}
          style={styles.fileRow}
        >
          <MaterialIcons name="insert-drive-file" size={20} color={theme.textSecondary} />
          <Text style={{ flex: 1, color: theme.text }} numberOfLines={1}>
            {file.name}
          </Text>
          <MaterialIcons name="open-in-new" size={18} color={theme.textSecondary} />
        </TouchableOpacity>
      ))}

      {unavailable > 0
        ? note(
            `${unavailable} attachment${unavailable === 1 ? '' : 's'} never finished uploading and can't be shown.`
          )
        : null}

      <AttachmentViewerModal visible={!!selected} attachment={selected} onClose={() => setSelected(null)} />
    </AdminPanel>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
});
