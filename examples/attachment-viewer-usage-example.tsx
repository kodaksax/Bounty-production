/**
 * Example usage of AttachmentViewerModal
 * 
 * This file demonstrates how to integrate the AttachmentViewerModal
 * component into any screen or modal within the application.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AttachmentViewerModal } from '../components/attachment-viewer-modal';
import type { Attachment } from '../lib/types';

/**
 * Example 1: Basic usage with a single attachment
 */
export function BasicAttachmentViewerExample() {
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  const sampleAttachment: Attachment = {
    id: '1',
    name: 'sample-image.jpg',
    uri: 'https://picsum.photos/800/600',
    mimeType: 'image/jpeg',
    size: 245000,
    status: 'uploaded',
  };

  const handleViewAttachment = () => {
    setSelectedAttachment(sampleAttachment);
    setViewerVisible(true);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.button} onPress={handleViewAttachment}>
        <Text style={styles.buttonText}>View Sample Image</Text>
      </TouchableOpacity>

      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={selectedAttachment}
        onClose={() => {
          setViewerVisible(false);
          setSelectedAttachment(null);
        }}
      />
    </View>
  );
}

/**
 * Example 2: Usage with a list of attachments
 */
export function AttachmentListWithViewerExample() {
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  const attachments: Attachment[] = [
    {
      id: '1',
      name: 'project-screenshot.png',
      uri: 'https://picsum.photos/800/600?random=1',
      mimeType: 'image/png',
      size: 420000,
      status: 'uploaded',
    },
    {
      id: '2',
      name: 'demo-video.mp4',
      uri: 'https://www.w3schools.com/html/mov_bbb.mp4',
      mimeType: 'video/mp4',
      size: 5400000,
      status: 'uploaded',
    },
    {
      id: '3',
      name: 'requirements.pdf',
      uri: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      mimeType: 'application/pdf',
      size: 13264,
      status: 'uploaded',
    },
  ];

  const handleViewAttachment = (attachment: Attachment) => {
    setSelectedAttachment(attachment);
    setViewerVisible(true);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Attachments</Text>
      {attachments.map((attachment) => (
        <TouchableOpacity
          key={attachment.id}
          style={styles.attachmentButton}
          onPress={() => handleViewAttachment(attachment)}
        >
          <Text style={styles.attachmentName}>{attachment.name}</Text>
          <Text style={styles.attachmentSize}>
            {((attachment.size || 0) / 1024).toFixed(1)} KB
          </Text>
        </TouchableOpacity>
      ))}

      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={selectedAttachment}
        onClose={() => {
          setViewerVisible(false);
          setSelectedAttachment(null);
        }}
      />
    </View>
  );
}

/**
 * Example 3: Integration with AttachmentsList component
 * 
 * The AttachmentsList component already has the viewer integrated,
 * so you can simply use it without managing the modal state yourself.
 */
export function IntegratedAttachmentsListExample() {
  const attachments: Attachment[] = [
    {
      id: '1',
      name: 'bounty-details.png',
      uri: 'https://picsum.photos/800/600?random=2',
      mimeType: 'image/png',
      size: 320000,
      status: 'uploaded',
    },
    {
      id: '2',
      name: 'contract.pdf',
      uri: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      mimeType: 'application/pdf',
      size: 13264,
      status: 'uploaded',
    },
  ];

  return (
    <View style={styles.container}>
      {/* AttachmentsList component automatically opens the viewer on tap */}
      <View style={{ padding: 16 }}>
        {/* Note: Import AttachmentsList from components/ui/attachments-list */}
        {/* <AttachmentsList attachments={attachments} /> */}
        <Text style={styles.note}>
          Import and use AttachmentsList component for automatic viewer integration
        </Text>
      </View>
    </View>
  );
}

/**
 * Example 4: Usage within a chat or messaging context
 */
export function ChatAttachmentExample() {
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  // This would typically come from a message object
  const messageAttachment: Attachment = {
    id: 'msg-att-1',
    name: 'photo.jpg',
    uri: 'https://picsum.photos/800/600?random=3',
    mimeType: 'image/jpeg',
    size: 450000,
    remoteUri: 'https://picsum.photos/800/600?random=3',
    status: 'uploaded',
  };

  const handleTapImage = () => {
    setSelectedAttachment(messageAttachment);
    setViewerVisible(true);
  };

  return (
    <View style={styles.container}>
      <View style={styles.chatBubble}>
        <TouchableOpacity onPress={handleTapImage}>
          <Text style={styles.chatText}>Tap the attachment to view it</Text>
          <View style={styles.attachmentPreview}>
            <Text style={styles.previewText}>📷 {messageAttachment.name}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={selectedAttachment}
        onClose={() => {
          setViewerVisible(false);
          setSelectedAttachment(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#004315',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#008e2a',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  attachmentButton: {
    backgroundColor: '#007523',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  attachmentName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  attachmentSize: {
    color: '#aad9b8',
    fontSize: 12,
  },
  note: {
    color: '#aad9b8',
    fontSize: 14,
    fontStyle: 'italic',
  },
  chatBubble: {
    backgroundColor: '#007523',
    padding: 12,
    borderRadius: 8,
    maxWidth: '80%',
  },
  chatText: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 8,
  },
  attachmentPreview: {
    backgroundColor: '#008e2a',
    padding: 8,
    borderRadius: 4,
  },
  previewText: {
    color: '#fff',
    fontSize: 12,
  },
});
