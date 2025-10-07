# Avatar Upload Feature

## Overview

The avatar upload feature allows users to select and upload profile pictures from their device. The implementation uses Expo's `DocumentPicker` for file selection and includes progress tracking, error handling, and automatic profile updates.

## Architecture

### Components

1. **EditProfileScreen** (`components/edit-profile-screen.tsx`)
   - Main UI component for editing profile information
   - Includes avatar upload UI with progress indicator
   - Shows success/error messages via dismissible banner

2. **AvatarService** (`lib/services/avatar-service.ts`)
   - Dedicated service for avatar upload/delete operations
   - Integrates with `attachmentService` for file uploads
   - Automatically updates profile with new avatar URL

3. **useAvatarUpload Hook** (`hooks/use-avatar-upload.ts`)
   - Custom React hook for reusable avatar upload logic
   - Provides state management for upload progress and errors
   - Easy integration in any component

## Usage

### Using in EditProfileScreen (Current Implementation)

The `EditProfileScreen` component already includes avatar upload functionality:

```tsx
import { EditProfileScreen } from 'components/edit-profile-screen'

<EditProfileScreen
  onBack={() => navigate('back')}
  initialAvatar="https://example.com/avatar.jpg"
  onSave={(data) => {
    console.log('New avatar URL:', data.avatar)
    // Save profile with new avatar
  }}
/>
```

### Using the Custom Hook

For other components, use the `useAvatarUpload` hook:

```tsx
import { useAvatarUpload } from 'hooks/use-avatar-upload'

function MyComponent() {
  const {
    isUploading,
    progress,
    avatarUrl,
    message,
    pickAndUploadAvatar,
    clearMessage,
  } = useAvatarUpload({
    profileId: 'user-123',
    onSuccess: (url) => console.log('Uploaded:', url),
    onError: (error) => console.error('Error:', error),
  })

  return (
    <TouchableOpacity onPress={pickAndUploadAvatar}>
      {isUploading ? (
        <Text>Uploading... {Math.round(progress * 100)}%</Text>
      ) : (
        <Text>Upload Avatar</Text>
      )}
    </TouchableOpacity>
  )
}
```

### Using the Avatar Service Directly

For more control, use the `avatarService` directly:

```tsx
import { avatarService } from 'lib/services/avatar-service'

async function uploadAvatar() {
  const { avatarUrl, error } = await avatarService.uploadAvatar(
    'file:///path/to/image.jpg',
    {
      profileId: 'user-123',
      fileName: 'avatar.jpg',
      mimeType: 'image/jpeg',
      onProgress: (progress) => {
        console.log(`Upload progress: ${Math.round(progress * 100)}%`)
      },
    }
  )

  if (error) {
    console.error('Upload failed:', error)
  } else {
    console.log('Uploaded to:', avatarUrl)
  }
}
```

## Features

### 1. Image Selection
- Uses `expo-document-picker` with `type: 'image/*'` filter
- Only allows image files (JPEG, PNG, etc.)
- Automatically copies to cache directory

### 2. Upload Progress
- Real-time progress tracking (0-100%)
- Visual progress indicator with `ActivityIndicator`
- Progress percentage displayed to user

### 3. Error Handling
- Graceful error handling for network failures
- Falls back to local URI if upload fails
- User-friendly error messages
- Auto-dismissing error banners (5 seconds)

### 4. Success Feedback
- Success message banner
- Auto-dismissing after 3 seconds
- Updates avatar preview immediately

### 5. Profile Integration
- Automatically updates `avatar_url` in profile
- Integrates with existing `profile-service`
- Maintains profile consistency

## UI Components

### Avatar Display
```tsx
<Avatar className="h-20 w-20 border-2 border-emerald-500">
  <AvatarImage src={avatar} alt="Profile" />
  <AvatarFallback className="bg-emerald-800 text-emerald-200">
    {name.substring(0, 2).toUpperCase()}
  </AvatarFallback>
</Avatar>
```

### Upload Button
```tsx
<TouchableOpacity
  onPress={handleAvatarClick}
  disabled={isUploadingAvatar}
>
  {isUploadingAvatar ? (
    <ActivityIndicator size="small" color="white" />
  ) : (
    <MaterialIcons name="camera-alt" size={16} color="white" />
  )}
</TouchableOpacity>
```

### Status Banner
```tsx
{uploadMessage && (
  <View className="bg-emerald-800 rounded-lg px-4 py-3">
    <Text className="text-white">{uploadMessage}</Text>
    <TouchableOpacity onPress={() => setUploadMessage(null)}>
      <MaterialIcons name="close" size={18} color="white" />
    </TouchableOpacity>
  </View>
)}
```

## Testing

Run the avatar upload tests:

```bash
node tests/avatar-upload.test.js
```

Tests cover:
- ✓ Upload without profile ID
- ✓ Upload with profile update
- ✓ Progress tracking
- ✓ Different file types
- ✓ Avatar deletion
- ✓ Error handling

## File Structure

```
bountyexpo/
├── components/
│   └── edit-profile-screen.tsx      # Main UI component
├── hooks/
│   └── use-avatar-upload.ts         # Custom hook
├── lib/
│   └── services/
│       ├── avatar-service.ts        # Avatar upload service
│       ├── attachment-service.ts    # Generic file upload
│       └── profile-service.ts       # Profile management
└── tests/
    └── avatar-upload.test.js        # Unit tests
```

## Future Enhancements

- [ ] Add image cropping before upload
- [ ] Support for image compression
- [ ] Multiple image format validation
- [ ] File size limits
- [ ] Image preview before upload
- [ ] Integration with cloud storage (S3, Cloudinary, etc.)
- [ ] Avatar cache management
- [ ] Offline support with queue

## API Integration

To integrate with a real backend, update the `attachmentService`:

```typescript
// lib/services/attachment-service.ts
async upload(attachment: AttachmentMeta, opts = {}) {
  const formData = new FormData()
  formData.append('file', {
    uri: attachment.uri,
    type: attachment.mimeType,
    name: attachment.name,
  })

  const response = await fetch('YOUR_API_URL/upload', {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })

  const data = await response.json()
  return {
    ...attachment,
    remoteUri: data.url,
    status: 'uploaded',
    progress: 1,
  }
}
```

## Security Considerations

- Validate file types on the server
- Enforce file size limits
- Sanitize file names
- Use secure URLs (HTTPS)
- Implement access control
- Scan uploads for malware
- Rate limit uploads

## Performance Tips

- Compress images before upload
- Use lazy loading for avatars
- Cache avatar images
- Implement progressive image loading
- Use CDN for avatar delivery
