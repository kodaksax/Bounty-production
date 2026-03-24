import { MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
// Lazy-load expo-media-library at runtime to avoid crashing when the
// native module is not present (e.g. running in Expo Go or mismatched dev client).
// The module will be imported dynamically inside handlers when needed.
import * as Sharing from 'expo-sharing';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { Attachment } from '../lib/types';

interface AttachmentViewerModalProps {
  visible: boolean;
  attachment: Attachment | null;
  onClose: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Modal component for viewing various types of attachments including:
 * - Images (jpg, png, gif, webp)
 * - Videos (mp4, mov)
 * - Documents (pdf, doc, docx)
 * - Other files
 * 
 * Features:
 * - Full-screen viewing with pinch-to-zoom for images
 * - Video playback with controls
 * - Document preview when possible
 * - Download/save functionality
 * - Security validations
 */
export function AttachmentViewerModal({
  visible,
  attachment,
  onClose,
}: AttachmentViewerModalProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const hasAttachment = Boolean(attachment);
  const mimeType = attachment?.mime || attachment?.mimeType || '';
  let uri = attachment?.remoteUri || attachment?.uri || '';
  
  if (uri && /^\/\//.test(uri)) {
    uri = `https:${uri}`;
  }
  
  const displayName = attachment?.name || 'Attachment';

  // Security validation
  const isValidUri = (uri: string): boolean => {
    if (!uri) return false;
    // Allow http, https, file, data, and content URIs
    return /^(https?|file|data|content):\/\//i.test(uri);
  };

  // File type detection
  const getFileType = (): 'image' | 'video' | 'pdf' | 'document' | 'other' => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.includes('pdf')) return 'pdf';
    if (
      mimeType.includes('document') ||
      mimeType.includes('word') ||
      mimeType.includes('text')
    ) {
      return 'document';
    }

    // Fallback: deduce from filename or uri extension
    const lowerName = (displayName || uri || '').toLowerCase();
    if (lowerName.match(/\.(jpg|jpeg|png|gif|webp|heic)$/i)) return 'image';
    if (lowerName.match(/\.(mp4|mov|avi|webm|mkv)$/i)) return 'video';
    if (lowerName.match(/\.pdf$/i)) return 'pdf';
    if (lowerName.match(/\.(doc|docx|txt|rtf)$/i)) return 'document';

    return 'other';
  };

  const fileType = getFileType();
  const isUriValid = isValidUri(uri);

  const videoSource = useMemo(() => {
    if (fileType === 'video' && isUriValid) {
      return { uri };
    }
    return null;
  }, [fileType, isUriValid, uri]);

  const videoPlayer = useVideoPlayer(videoSource, (player) => {
    player.pause();
    player.loop = false;
    player.muted = false;
  });

  // Check if file size is reasonable (< 100MB for viewing)
  const isFileSizeReasonable = !attachment?.size || attachment.size < 100 * 1024 * 1024;

  useEffect(() => {
    setVideoError(null);
  }, [attachment?.id]);

  useEffect(() => {
    if (fileType !== 'video' || !videoSource) {
      return;
    }

    const subscription = videoPlayer.addListener('statusChange', ({ status, error }) => {
      if (status === 'error' && error) {
        console.error('[AttachmentViewer] Video playback error:', error);
        setVideoError(error.message ?? 'Unable to play this video');
      }
    });

    return () => {
      subscription.remove();
    };
  }, [fileType, videoPlayer, videoSource]);

  useEffect(() => {
    if (!visible) {
      videoPlayer.pause();
    }
  }, [visible, videoPlayer]);

  /**
   * Download/save attachment to device
   */
  const handleDownload = async () => {
    if (!attachment || !isValidUri(uri)) {
      Alert.alert('Error', 'Invalid file URI');
      return;
    }

    setIsDownloading(true);
    try {
      // For images and videos on device, save to photos/gallery when possible
      if ((fileType === 'image' || fileType === 'video') && Platform.OS !== 'web') {
        // Lazy-import expo-media-library and feature-detect the native module
        // to avoid crashing when running in environments that don't include
        // the native module (e.g. mismatched Expo Go / dev client).
        let mediaLib: any = null;
        try {
          mediaLib = await import('expo-media-library');
        } catch (err) {
          mediaLib = null;
        }

        let mediaLibAvailable = !!(
          mediaLib &&
          typeof mediaLib.requestPermissionsAsync === 'function' &&
          typeof mediaLib.saveToLibraryAsync === 'function'
        );

        if (mediaLibAvailable) {
          try {
            const permResult = await mediaLib.requestPermissionsAsync();
            const status = permResult?.status ?? permResult;
            if (status !== 'granted') {
              Alert.alert('Permission required', 'Please grant photo permissions to save media to your device.');
              return;
            }
          } catch (err) {
            console.warn('[AttachmentViewer] MediaLibrary not available:', err);
            mediaLibAvailable = false;
          }
        }

        // Determine filename with extension (prefer name/uri, then common mime-type map)
        const suggestedName = attachment.name || `file-${Date.now()}`;
        const extMatch = (suggestedName || uri || '').match(/(\.[a-z0-9]+)(?:\?.*)?$/i);

        const extension = extMatch
          ? extMatch[1]
          : (() => {
              if (!mimeType) return '';
              const cleaned = mimeType.split(';')[0].trim().toLowerCase();
              const mimeMap: Record<string, string> = {
                'image/jpeg': '.jpg',
                'image/jpg': '.jpg',
                'image/png': '.png',
                'image/gif': '.gif',
                'image/webp': '.webp',
                'image/heic': '.heic',
                'video/mp4': '.mp4',
                'video/quicktime': '.mov',
                'video/x-msvideo': '.avi',
                'application/pdf': '.pdf',
                'application/msword': '.doc',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
                'text/plain': '.txt',
                'application/rtf': '.rtf',
              };

              if (mimeMap[cleaned]) return mimeMap[cleaned];

              const parts = cleaned.split('/');
              if (parts.length === 2 && parts[1]) {
                // take subtype (without +suffix) if it looks safe
                const subtype = parts[1].split('+')[0];
                if (/^[a-z0-9.-]+$/.test(subtype)) return `.${subtype}`;
              }

              return '';
            })();

        const filename = extension && !suggestedName.toLowerCase().endsWith(extension.toLowerCase())
          ? `${suggestedName}${extension}`
          : suggestedName;

        const cacheDir = (FileSystem as any).cacheDirectory || '';
        const localCandidate = `${cacheDir}${filename}`;

        // Normalize local files: if the source is a local file URI but lacks an extension,
        // copy it into cache with the computed filename (which includes the normalized extension).
        let finalLocalUri = uri;
        if (uri.startsWith('file://')) {
          const uriPath = uri.split('?')[0];
          const hasExtOnUri = /(\.[a-z0-9]+)$/i.test(uriPath);
          if (!hasExtOnUri && filename) {
            try {
              await FileSystem.copyAsync({ from: uri, to: localCandidate });
              finalLocalUri = localCandidate;
            } catch (copyErr) {
              console.error('[AttachmentViewer] copy local file error:', copyErr);
              // Fall back to original uri if copy fails
              finalLocalUri = uri;
            }
          } else {
            finalLocalUri = uri;
          }
        } else {
          // Remote URL: download into cache with the computed filename
          const downloadResult = await FileSystem.downloadAsync(uri, localCandidate);
          if (downloadResult.status && downloadResult.status !== 200) {
            throw new Error('Download failed');
          }
          finalLocalUri = downloadResult.uri;
        }

        // Save to library if available, otherwise fallback to sharing
        if (mediaLib && typeof mediaLib.saveToLibraryAsync === 'function') {
          try {
            await mediaLib.saveToLibraryAsync(finalLocalUri);
            Alert.alert('Saved', 'Media saved to your device gallery.');
          } catch (err) {
            const e = err as any;
            console.error('[AttachmentViewer] MediaLibrary save error:', e);

            const rawMsg = (e && (e.message || e.toString())) || 'Unknown error';
            const userMessage = (() => {
              const m = String(rawMsg).toLowerCase();
              if (/insufficient|no space|enospc|disk full/.test(m)) {
                return 'Unable to save media: insufficient storage on device.';
              }
              if (/permission|denied|not authorized|not allowed/.test(m)) {
                return 'Unable to save media: permission denied. Please enable photo/storage permissions in your device settings.';
              }
              if (/format|unsupported|not supported|invalid file/.test(m)) {
                return 'Unable to save media: file format not supported by your device.';
              }
              return `Unable to save media: ${rawMsg}`;
            })();

            const isAvailable = await Sharing.isAvailableAsync();
            if (isAvailable) {
              try {
                await Sharing.shareAsync(finalLocalUri, {
                  mimeType: mimeType,
                  dialogTitle: 'Share File',
                  UTI: mimeType,
                });
                Alert.alert('Could not save', `${userMessage}\nOpened share sheet as a fallback.`);
              } catch (shareErr) {
                console.error('[AttachmentViewer] Sharing fallback error:', shareErr);
                Alert.alert('Error', userMessage);
              }
            } else {
              Alert.alert('Error', userMessage);
              throw e;
            }
          }
        } else {
          // Native MediaLibrary missing — open share sheet as fallback
          const isAvailable = await Sharing.isAvailableAsync();
          if (isAvailable) {
            try {
              await Sharing.shareAsync(finalLocalUri, {
                mimeType: mimeType,
                dialogTitle: 'Share File',
                UTI: mimeType,
              });
              Alert.alert('Saved', 'Opened share sheet as a fallback to save/share the file.');
            } catch (shareErr) {
              console.error('[AttachmentViewer] Sharing fallback error:', shareErr);
              Alert.alert('Error', 'Unable to save file on this device.');
            }
          } else {
            Alert.alert('Error', 'Unable to save file on this device.');
          }
        }
      } else if (fileType === 'pdf' || fileType === 'document' || fileType === 'other') {
        // For documents and other files, use sharing
        const isAvailable = await Sharing.isAvailableAsync();
        if (!isAvailable) {
          Alert.alert('Error', 'Sharing is not available on this device');
          return;
        }

        const filename = attachment.name || `file-${Date.now()}`;
        let shareUri = uri;

        // If remote URL, download first
        if (!uri.startsWith('file://')) {
          const cacheDir = (FileSystem as any).cacheDirectory || '';
          const localUri = `${cacheDir}${filename}`;
          const downloadResult = await FileSystem.downloadAsync(uri, localUri);
          
          if (downloadResult.status !== 200) {
            throw new Error('Download failed');
          }
          shareUri = downloadResult.uri;
        }

        await Sharing.shareAsync(shareUri, {
          mimeType: mimeType,
          dialogTitle: 'Save File',
          UTI: mimeType,
        });

        Alert.alert('Success', 'File saved successfully!');
      } else {
        Alert.alert('Info', 'Video download is not supported. You can share instead.');
      }
    } catch (error) {
      console.error('[AttachmentViewer] Download error:', error);
      Alert.alert('Error', 'Failed to save file. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  /**
   * Render content based on file type
   */
  const renderContent = () => {
    if (!hasAttachment) {
      return (
        <View style={styles.errorContainer}>
          <MaterialIcons name="insert-drive-file" size={64} color="#6ee7b7" />
          <Text style={styles.errorText}>No attachment selected</Text>
        </View>
      );
    }

    if (!isUriValid) {
      return (
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={64} color="#ef4444" />
          <Text style={styles.errorText}>Invalid file URI</Text>
        </View>
      );
    }

    if (!isFileSizeReasonable) {
      return (
        <View style={styles.errorContainer}>
          <MaterialIcons name="warning" size={64} color="#f59e0b" />
          <Text style={styles.errorText}>File too large to preview</Text>
          <Text style={styles.errorSubtext}>You can still download it</Text>
        </View>
      );
    }

    switch (fileType) {
      case 'image':
        return (
          <ScrollView
            contentContainerStyle={styles.imageScrollContainer}
            maximumZoomScale={3}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image
              source={{ uri }}
              style={styles.image}
              resizeMode="contain"
              onError={(error) => {
                console.error('[AttachmentViewer] Image load error:', error);
              }}
            />
          </ScrollView>
        );

      case 'video':
        return (
          <View style={styles.videoContainer}>
            {videoError ? (
              <View style={styles.errorContainer}>
                <MaterialIcons name="error-outline" size={64} color="#ef4444" />
                <Text style={styles.errorText}>Unable to play this video</Text>
                <Text style={styles.errorSubtext}>{videoError}</Text>
              </View>
            ) : (
              <VideoView
                player={videoPlayer}
                style={styles.video}
                nativeControls
                contentFit="contain"
              />
            )}
          </View>
        );

      case 'pdf':
        // PDF preview using WebView for web, otherwise show download option
        if (Platform.OS === 'web') {
          return (
            <WebView
              source={{ uri }}
              style={styles.webview}
              onError={(error) => {
                console.error('[AttachmentViewer] PDF load error:', error);
              }}
            />
          );
        } else {
          // For mobile, show a preview icon and download button
          return (
            <View style={styles.documentPreview}>
              <MaterialIcons name="picture-as-pdf" size={80} color="#ef4444" />
              <Text style={styles.documentName}>{displayName}</Text>
              <Text style={styles.documentHint}>Tap download to view this PDF</Text>
            </View>
          );
        }

      case 'document':
        return (
          <View style={styles.documentPreview}>
            <MaterialIcons name="description" size={80} color="#10b981" />
            <Text style={styles.documentName}>{displayName}</Text>
            <Text style={styles.documentHint}>Tap download to view this document</Text>
          </View>
        );

      case 'other':
      default:
        return (
          <View style={styles.documentPreview}>
            <MaterialIcons name="insert-drive-file" size={80} color="#6ee7b7" />
            <Text style={styles.documentName}>{displayName}</Text>
            <Text style={styles.documentHint}>Tap download to view this file</Text>
          </View>
        );
    }
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {displayName}
            </Text>
            {attachment?.size && (
              <Text style={styles.fileSize}>{formatFileSize(attachment.size)}</Text>
            )}
          </View>
          <View style={styles.headerActions}>
            {/* Download/Save Button */}
            {fileType !== 'video' && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleDownload}
                disabled={isDownloading}
                accessibilityLabel="Download attachment"
                accessibilityRole="button"
              >
                {isDownloading ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <MaterialIcons name="file-download" size={24} color="white" />
                )}
              </TouchableOpacity>
            )}

            {/* Close Button */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={onClose}
              accessibilityLabel="Close viewer"
              accessibilityRole="button"
            >
              <MaterialIcons name="close" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        <View style={styles.content}>{renderContent()}</View>

        {/* Footer Info */}
        <View style={styles.footer}>
          <View style={styles.footerContent}>
            <MaterialIcons name="info-outline" size={16} color="#a7f3d0" />
            <Text style={styles.footerText}>
              {fileType === 'video'
                ? 'Video files cannot be downloaded, but you can share them'
                : 'Tap the download icon to save this file to your device'}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: Platform.OS === 'ios' ? 50 : 12,
    backgroundColor: '#047857', // emerald-700
  },
  headerInfo: {
    flex: 1,
    marginRight: 12,
  },
  fileName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  fileSize: {
    color: '#a7f3d0',
    fontSize: 12,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageScrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 150,
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  video: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 150,
  },
  webview: {
    flex: 1,
    backgroundColor: '#fff',
  },
  documentPreview: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  documentName: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  documentHint: {
    color: '#a7f3d0',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  errorSubtext: {
    color: '#a7f3d0',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#047857', // emerald-700
  },
  footerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {
    flex: 1,
    color: '#a7f3d0',
    fontSize: 12,
    lineHeight: 18,
  },
});
