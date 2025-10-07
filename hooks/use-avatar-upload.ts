import * as DocumentPicker from 'expo-document-picker'
import { useState } from 'react'
import { avatarService } from '../lib/services/avatar-service'

interface UseAvatarUploadOptions {
  profileId?: string
  onSuccess?: (avatarUrl: string) => void
  onError?: (error: Error) => void
}

interface AvatarUploadState {
  isUploading: boolean
  progress: number
  avatarUrl: string | null
  error: Error | null
  message: string | null
}

/**
 * Custom hook for handling avatar uploads with DocumentPicker and progress tracking
 */
export function useAvatarUpload(options: UseAvatarUploadOptions = {}) {
  const [state, setState] = useState<AvatarUploadState>({
    isUploading: false,
    progress: 0,
    avatarUrl: null,
    error: null,
    message: null,
  })

  const pickAndUploadAvatar = async () => {
    try {
      // Open document picker for images only
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      })

      if (result.canceled) {
        return { success: false, avatarUrl: null }
      }

      if (!result.assets || result.assets.length === 0) {
        throw new Error('No image selected')
      }

      const selectedImage = result.assets[0]

      // Update state to uploading
      setState((prev) => ({
        ...prev,
        isUploading: true,
        progress: 0,
        error: null,
        message: 'Uploading...',
      }))

      // Upload the avatar
      const { avatarUrl, error } = await avatarService.uploadAvatar(
        selectedImage.uri,
        {
          profileId: options.profileId,
          fileName: selectedImage.name || 'avatar.jpg',
          mimeType: selectedImage.mimeType,
          size: selectedImage.size,
          onProgress: (progress) => {
            setState((prev) => ({ ...prev, progress }))
          },
        }
      )

      if (error || !avatarUrl) {
        throw error || new Error('Upload failed')
      }

      // Success
      setState({
        isUploading: false,
        progress: 1,
        avatarUrl,
        error: null,
        message: 'Profile picture uploaded successfully!',
      })

      // Clear message after 3 seconds
      setTimeout(() => {
        setState((prev) => ({ ...prev, message: null }))
      }, 3000)

      // Call success callback
      options.onSuccess?.(avatarUrl)

      return { success: true, avatarUrl }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      
      setState({
        isUploading: false,
        progress: 0,
        avatarUrl: null,
        error,
        message: `Upload failed: ${error.message}`,
      })

      // Clear error message after 5 seconds
      setTimeout(() => {
        setState((prev) => ({ ...prev, message: null, error: null }))
      }, 5000)

      // Call error callback
      options.onError?.(error)

      return { success: false, avatarUrl: null }
    }
  }

  const clearMessage = () => {
    setState((prev) => ({ ...prev, message: null }))
  }

  const reset = () => {
    setState({
      isUploading: false,
      progress: 0,
      avatarUrl: null,
      error: null,
      message: null,
    })
  }

  return {
    ...state,
    pickAndUploadAvatar,
    clearMessage,
    reset,
  }
}
