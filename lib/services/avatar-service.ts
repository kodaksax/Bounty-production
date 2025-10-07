import type { AttachmentMeta } from './database.types'
import { attachmentService } from './attachment-service'
import { profileService } from './profile-service'

/**
 * Service for handling profile picture (avatar) uploads
 */
export const avatarService = {
  /**
   * Upload a profile picture and optionally update the profile with the new avatar URL
   * @param imageUri - Local URI of the selected image
   * @param profileId - Optional profile ID to update after upload
   * @param onProgress - Optional progress callback (0-1)
   * @returns The uploaded avatar URL or null on failure
   */
  async uploadAvatar(
    imageUri: string,
    options: {
      profileId?: string
      fileName?: string
      mimeType?: string
      size?: number
      onProgress?: (progress: number) => void
    } = {}
  ): Promise<{ avatarUrl: string | null; error: Error | null }> {
    try {
      // Validate file size (5MB limit)
      const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB in bytes
      if (options.size && options.size > MAX_FILE_SIZE) {
        throw new Error('Image too large. Maximum size is 5MB')
      }

      // Create attachment metadata for the avatar
      const attachment: AttachmentMeta = {
        id: `avatar-${Date.now()}`,
        name: options.fileName || 'avatar.jpg',
        uri: imageUri,
        mimeType: options.mimeType || 'image/jpeg',
        size: options.size,
        status: 'uploading',
        progress: 0,
      }

      // Upload the image using the attachment service
      const uploaded = await attachmentService.upload(attachment, {
        onProgress: options.onProgress,
      })

      if (uploaded.status !== 'uploaded' || !uploaded.remoteUri) {
        throw new Error('Upload failed - no remote URI returned')
      }

      // If profileId is provided, update the profile with the new avatar URL
      if (options.profileId) {
        const updatedProfile = await profileService.update(options.profileId, {
          avatar_url: uploaded.remoteUri,
        })

        if (!updatedProfile) {
          // Upload succeeded but profile update failed
          console.warn('Avatar uploaded but profile update failed')
        }
      }

      return { avatarUrl: uploaded.remoteUri, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error uploading avatar')
      console.error('Avatar upload error:', error)
      return { avatarUrl: null, error }
    }
  },

  /**
   * Delete an avatar (placeholder for future implementation)
   */
  async deleteAvatar(profileId: string): Promise<{ success: boolean; error: Error | null }> {
    try {
      // Update profile to remove avatar_url
      const updatedProfile = await profileService.update(profileId, {
        avatar_url: '',
      })

      if (!updatedProfile) {
        throw new Error('Failed to update profile')
      }

      return { success: true, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error deleting avatar')
      console.error('Avatar delete error:', error)
      return { success: false, error }
    }
  },
}
