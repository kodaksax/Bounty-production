# Attachment Viewer Modal - Implementation Documentation

## Overview

The Attachment Viewer Modal is a comprehensive, reusable component that facilitates viewing and downloading various types of attachments throughout the BOUNTYExpo application. It provides a secure, user-friendly interface for handling images, videos, documents, and other file types.

## Features

### 1. Multi-Format Support
- **Images**: jpg, jpeg, png, gif, webp with pinch-to-zoom capability
- **Videos**: mp4, mov with native playback controls
- **Documents**: PDF, Word documents (doc, docx) with preview where possible
- **Other Files**: Generic file viewing and download support

### 2. Download & Save Capabilities
- **Images**: Save directly to device gallery via sharing functionality
- **Documents & Files**: Download and share via system share sheet
- **Videos**: Share functionality (note: direct download excluded as per requirements)
- **Progress Indicators**: Visual feedback during download operations

### 3. Security Features
- **URI Validation**: Ensures only valid URIs (http, https, file, data, content) are processed
- **File Size Limits**: Prevents viewing files larger than 100MB to avoid memory issues
- **Error Handling**: Graceful error handling with user-friendly messages
- **MIME Type Validation**: Proper file type detection and handling

### 4. User Experience
- **Emerald Theme**: Consistent with BOUNTYExpo design system
- **Full-Screen Viewing**: Immersive experience for all media types
- **Accessibility**: Proper labels and roles for screen readers
- **Touch-Friendly**: Large tap targets and intuitive gestures
- **Loading States**: Clear feedback during operations

## Architecture

### Component Structure

```
components/
├── attachment-viewer-modal.tsx       # Main modal component
└── ui/
    └── attachments-list.tsx          # List component with integrated viewer
```

### Dependencies

All required dependencies are already included in the project:
- `expo-file-system`: File operations and downloads
- `expo-sharing`: Device share/save functionality
- `expo-video`: Video playback
- `react-native-webview`: Document preview (web only)
- `@expo/vector-icons`: UI icons

## Usage

### Method 1: Direct Usage (Full Control)

Use this method when you need complete control over when and how the modal appears:

```tsx
import React, { useState } from 'react';
import { AttachmentViewerModal } from './components/attachment-viewer-modal';
import type { Attachment } from './lib/types';

function MyComponent() {
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  const handleViewAttachment = (attachment: Attachment) => {
    setSelectedAttachment(attachment);
    setViewerVisible(true);
  };

  return (
    <>
      {/* Your UI here */}
      <Button onPress={() => handleViewAttachment(someAttachment)} />
      
      {/* Attachment Viewer Modal */}
      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={selectedAttachment}
        onClose={() => {
          setViewerVisible(false);
          setSelectedAttachment(null);
        }}
      />
    </>
  );
}
```

### Method 2: Using AttachmentsList (Automatic Integration)

Use this method for quick integration with automatic modal management:

```tsx
import { AttachmentsList } from './components/ui/attachments-list';
import type { Attachment } from './lib/types';

function MyComponent() {
  const attachments: Attachment[] = [
    {
      id: '1',
      name: 'photo.jpg',
      uri: 'https://example.com/photo.jpg',
      mimeType: 'image/jpeg',
      size: 245000,
      status: 'uploaded',
    },
    // ... more attachments
  ];

  return (
    <AttachmentsList attachments={attachments} />
    // Modal is automatically managed - tapping an attachment opens the viewer
  );
}
```

### Method 3: Custom Handler with AttachmentsList

Use this method when you want to intercept attachment taps:

```tsx
import { AttachmentsList } from './components/ui/attachments-list';

function MyComponent() {
  const handleAttachmentPress = (attachment: Attachment) => {
    // Custom logic (e.g., logging, analytics)
    console.log('Attachment tapped:', attachment.name);
    // The viewer will still open automatically
  };

  return (
    <AttachmentsList 
      attachments={attachments}
      onAttachmentPress={handleAttachmentPress}
    />
  );
}
```

## Integration Examples

### In Chat/Messaging Screens

```tsx
// app/tabs/chat-detail-screen.tsx
import { AttachmentViewerModal } from '../../components/attachment-viewer-modal';

function ChatDetailScreen() {
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  const handleImagePress = (message: Message) => {
    if (message.attachment) {
      setSelectedAttachment(message.attachment);
      setViewerVisible(true);
    }
  };

  return (
    <View>
      {/* Your chat messages */}
      <FlatList
        data={messages}
        renderItem={({ item }) => (
          <MessageBubble 
            message={item}
            onAttachmentPress={() => handleImagePress(item)}
          />
        )}
      />

      {/* Viewer Modal */}
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
```

### In Bounty Detail Modal

```tsx
// components/bountydetailmodal.tsx
import { AttachmentsList } from './ui/attachments-list';

function BountyDetailModal({ bounty }) {
  return (
    <ScrollView>
      {/* Bounty details */}
      <Text>{bounty.title}</Text>
      <Text>{bounty.description}</Text>
      
      {/* Attachments with integrated viewer */}
      {bounty.attachments && bounty.attachments.length > 0 && (
        <AttachmentsList attachments={bounty.attachments} />
      )}
    </ScrollView>
  );
}
```

### In Profile Portfolio Section

```tsx
// components/enhanced-profile-section.tsx
import { AttachmentsList } from './ui/attachments-list';

function PortfolioSection({ portfolio }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Portfolio</Text>
      <AttachmentsList attachments={portfolio.items} />
    </View>
  );
}
```

## Attachment Type Interface

```typescript
export interface Attachment {
  id: string;                     // Unique identifier
  name: string;                   // File name
  uri: string;                    // Local or data URI
  mime?: string;                  // MIME type (alternative)
  mimeType?: string;              // MIME type (preferred)
  size?: number;                  // File size in bytes
  remoteUri?: string;             // Remote URL after upload
  status?: 'pending' | 'uploading' | 'uploaded' | 'failed';
  progress?: number;              // Upload progress (0-1)
}
```

## Security Considerations

### 1. URI Validation
The component validates all URIs before attempting to load them:
- Accepts: `http://`, `https://`, `file://`, `data://`, `content://`
- Rejects: Invalid or potentially malicious URIs
- Error: Displays clear error message to user

### 2. File Size Limits
Files larger than 100MB are not loaded into memory for viewing:
- Prevents app crashes from memory issues
- Still allows download/save functionality
- Shows clear message about file size

### 3. MIME Type Detection
Proper MIME type handling prevents security issues:
- Validates content type before rendering
- Uses appropriate viewer for each type
- Falls back to generic file view if type unknown

### 4. Error Boundaries
All file operations are wrapped in try-catch blocks:
- Network failures handled gracefully
- Permission errors reported to user
- Corrupted files don't crash the app

### 5. Permission Handling
Download/save operations check for permissions:
- Verifies sharing availability on device
- Requests permissions when needed
- Provides clear feedback if permissions denied

## Platform-Specific Behavior

### iOS
- Full support for all file types
- Native share sheet for downloads
- Camera roll integration for images
- PDF preview in viewer (WebView)

### Android
- Full support for all file types
- Native share dialog for downloads
- Gallery integration for images
- PDF preview in viewer (WebView)

### Web
- Limited file download support
- PDF preview via iframe
- Video preview supported
- Share functionality may be limited

## Performance Considerations

### Memory Management
- Images are loaded on-demand, not preloaded
- Large files (>100MB) are not loaded into memory
- Proper cleanup when modal closes
- Video uses native controls (hardware acceleration)

### Network Efficiency
- Downloads cached locally before sharing
- Reuses cached files when possible
- Progress feedback during downloads
- Handles network failures gracefully

## Testing

### Manual Testing Checklist

- [ ] Test image viewing (jpg, png, gif, webp)
- [ ] Test video playback (mp4, mov)
- [ ] Test PDF viewing
- [ ] Test document handling (doc, docx)
- [ ] Test unknown file types
- [ ] Test download/save for images
- [ ] Test download/save for documents
- [ ] Test with large files (>100MB)
- [ ] Test with invalid URIs
- [ ] Test with missing files (404)
- [ ] Test network failure scenarios
- [ ] Test on iOS device
- [ ] Test on Android device
- [ ] Test accessibility features
- [ ] Test with VoiceOver/TalkBack
- [ ] Test permission handling

### Integration Testing

Test the component in various contexts:
- [ ] Chat messages with attachments
- [ ] Bounty details with attachments
- [ ] Profile portfolio items
- [ ] Any other screen with file attachments

## Accessibility

### Screen Reader Support
- All buttons have proper `accessibilityLabel` props
- Modal has `accessibilityRole` set appropriately
- File information announced to screen readers
- Action feedback provided via alerts

### Keyboard Navigation
- Modal can be closed with back button (Android)
- Modal can be closed with gesture (iOS)
- All interactive elements are keyboard accessible

### Visual Accessibility
- High contrast emerald theme
- Clear visual hierarchy
- Sufficient touch target sizes (44x44 minimum)
- Clear error states with icons and text

## Troubleshooting

### Issue: Image not loading
**Solution**: Check that the URI is valid and accessible. Verify network connectivity.

### Issue: Download fails
**Solution**: Ensure device has sufficient storage. Check app permissions for file access.

### Issue: PDF not previewing on mobile
**Solution**: This is expected behavior. Mobile devices show a download button for PDFs.

### Issue: Video not playing
**Solution**: Verify video format is supported (mp4, mov). Check codec compatibility.

### Issue: Large file viewer hangs
**Solution**: Files >100MB should show a warning, not load into memory. This is intentional.

## Future Enhancements

Potential improvements for future versions:
- [ ] Image zoom and pan gestures
- [ ] Multi-image gallery with swipe navigation
- [ ] Thumbnail preview before full view
- [ ] In-app PDF reader for mobile
- [ ] Audio file playback support
- [ ] Archive file preview (zip, tar)
- [ ] Cloud storage integration
- [ ] Offline caching strategy
- [ ] Sharing to specific apps
- [ ] Edit capabilities (crop, rotate)

## Contributing

When modifying the attachment viewer:
1. Maintain backward compatibility with existing `Attachment` interface
2. Follow the emerald theme color scheme
3. Add appropriate error handling for new features
4. Update this documentation
5. Test on both iOS and Android
6. Consider accessibility implications
7. Run type checking: `npx tsc --noEmit`

## Support

For issues or questions:
- Check the examples in `examples/attachment-viewer-usage-example.tsx`
- Review this documentation
- Check the implementation in `components/attachment-viewer-modal.tsx`
- Test with the provided example attachments
