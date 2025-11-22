/**
 * Test/Demo screen for AttachmentViewerModal
 * 
 * This screen demonstrates the attachment viewer functionality
 * and can be used for manual testing and validation.
 * 
 * To use this screen, you can:
 * 1. Import it in your app's navigation
 * 2. Link to it from a test menu
 * 3. Use it during development to test attachment viewing
 */

import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttachmentViewerModal } from '../components/attachment-viewer-modal';
import type { Attachment } from '../lib/types';

export function AttachmentViewerTestScreen() {
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const insets = useSafeAreaInsets();

  // Sample attachments for testing different file types
  const sampleAttachments: Attachment[] = [
    {
      id: '1',
      name: 'sample-image-1.jpg',
      uri: 'https://picsum.photos/800/600',
      mimeType: 'image/jpeg',
      size: 245000,
      status: 'uploaded',
      remoteUri: 'https://picsum.photos/800/600',
    },
    {
      id: '2',
      name: 'sample-image-2.png',
      uri: 'https://picsum.photos/600/800',
      mimeType: 'image/png',
      size: 320000,
      status: 'uploaded',
      remoteUri: 'https://picsum.photos/600/800',
    },
    {
      id: '3',
      name: 'sample-video.mp4',
      uri: 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      mimeType: 'video/mp4',
      size: 5400000,
      status: 'uploaded',
      remoteUri: 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    },
    {
      id: '4',
      name: 'sample-document.pdf',
      uri: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      mimeType: 'application/pdf',
      size: 13264,
      status: 'uploaded',
      remoteUri: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    },
    {
      id: '5',
      name: 'unknown-file.xyz',
      uri: 'https://example.com/file.xyz',
      mimeType: 'application/octet-stream',
      size: 50000,
      status: 'uploaded',
      remoteUri: 'https://example.com/file.xyz',
    },
  ];

  const handleViewAttachment = (attachment: Attachment) => {
    setSelectedAttachment(attachment);
    setViewerVisible(true);
  };

  const handleCloseViewer = () => {
    setViewerVisible(false);
    setTimeout(() => {
      setSelectedAttachment(null);
    }, 300);
  };

  const getFileIcon = (mimeType: string): string => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'videocam';
    if (mimeType.includes('pdf')) return 'picture-as-pdf';
    return 'insert-drive-file';
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <View
      style={[
        styles.safeArea,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) },
      ]}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <MaterialIcons name="attach-file" size={24} color="#10b981" />
          <Text style={styles.headerTitle}>Attachment Viewer Test</Text>
        </View>

        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <MaterialIcons name="info-outline" size={20} color="#6ee7b7" />
          <Text style={styles.infoText}>
            Tap any attachment below to test the viewer modal. Try downloading images and documents!
          </Text>
        </View>

        {/* Attachments List */}
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.sectionTitle}>Sample Attachments</Text>

          {sampleAttachments.map((attachment) => (
            <TouchableOpacity
              key={attachment.id}
              style={styles.attachmentCard}
              onPress={() => handleViewAttachment(attachment)}
              activeOpacity={0.7}
            >
              <View style={styles.iconContainer}>
                <MaterialIcons
                  name={getFileIcon(attachment.mimeType || '') as any}
                  size={32}
                  color="#10b981"
                />
              </View>
              <View style={styles.attachmentInfo}>
                <Text style={styles.attachmentName} numberOfLines={1}>
                  {attachment.name}
                </Text>
                <Text style={styles.attachmentMeta}>
                  {attachment.mimeType?.split('/')[1]?.toUpperCase() || 'FILE'} •{' '}
                  {formatFileSize(attachment.size || 0)}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#6ee7b7" />
            </TouchableOpacity>
          ))}

          {/* Testing Instructions */}
          <View style={styles.instructionsCard}>
            <Text style={styles.instructionsTitle}>Testing Checklist</Text>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistText}>✓ Tap images to view in full screen</Text>
            </View>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistText}>✓ Try downloading an image</Text>
            </View>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistText}>✓ Test video playback controls</Text>
            </View>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistText}>✓ View PDF document</Text>
            </View>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistText}>✓ Check unknown file type handling</Text>
            </View>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistText}>✓ Test on different devices</Text>
            </View>
            <View style={styles.checklistItem}>
              <Text style={styles.checklistText}>✓ Verify accessibility features</Text>
            </View>
          </View>

          {/* Features Info */}
          <View style={styles.featuresCard}>
            <Text style={styles.featuresTitle}>Features to Test</Text>
            <View style={styles.featureItem}>
              <MaterialIcons name="image" size={18} color="#10b981" />
              <Text style={styles.featureText}>Image viewing with zoom</Text>
            </View>
            <View style={styles.featureItem}>
              <MaterialIcons name="videocam" size={18} color="#10b981" />
              <Text style={styles.featureText}>Video playback</Text>
            </View>
            <View style={styles.featureItem}>
              <MaterialIcons name="file-download" size={18} color="#10b981" />
              <Text style={styles.featureText}>Download & save</Text>
            </View>
            <View style={styles.featureItem}>
              <MaterialIcons name="share" size={18} color="#10b981" />
              <Text style={styles.featureText}>Share functionality</Text>
            </View>
            <View style={styles.featureItem}>
              <MaterialIcons name="security" size={18} color="#10b981" />
              <Text style={styles.featureText}>Security validations</Text>
            </View>
            <View style={styles.featureItem}>
              <MaterialIcons name="accessibility" size={18} color="#10b981" />
              <Text style={styles.featureText}>Accessibility support</Text>
            </View>
          </View>
        </ScrollView>

        {/* Attachment Viewer Modal */}
        <AttachmentViewerModal
          visible={viewerVisible}
          attachment={selectedAttachment}
          onClose={handleCloseViewer}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#064e3b', // emerald-800
  },
  container: {
    flex: 1,
    backgroundColor: '#064e3b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#047857', // emerald-700
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110, 231, 183, 0.2)',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    margin: 16,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.3)',
  },
  infoText: {
    flex: 1,
    color: '#d1fae5',
    fontSize: 13,
    lineHeight: 18,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10b981',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  attachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    marginBottom: 8,
    backgroundColor: '#047857',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  iconContainer: {
    width: 48,
    height: 48,
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
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
  },
  attachmentMeta: {
    color: '#a7f3d0',
    fontSize: 12,
  },
  instructionsCard: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#047857',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10b981',
    marginBottom: 12,
  },
  checklistItem: {
    paddingVertical: 6,
  },
  checklistText: {
    color: '#d1fae5',
    fontSize: 14,
    lineHeight: 20,
  },
  featuresCard: {
    marginTop: 16,
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#047857',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  featuresTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10b981',
    marginBottom: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  featureText: {
    color: '#d1fae5',
    fontSize: 14,
  },
});
