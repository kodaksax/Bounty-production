import type { AttachmentMeta } from './database.types'
import { storageService } from './storage-service'

/**
 * Attachment upload service using Supabase Storage with AsyncStorage fallback.
 */
export const attachmentService = {
  /**
   * Upload an attachment to storage with progress callbacks.
   * @param attachment - Attachment metadata with local URI
   * @param opts - Options including progress callback
   * @returns Updated attachment metadata with remote URI
   */
  async upload(
    attachment: AttachmentMeta,
    opts: { onProgress?: (p: number) => void } = {}
  ): Promise<AttachmentMeta> {
    const { onProgress } = opts

    try {
      onProgress?.(0.1)

      // Generate file path
      const timestamp = Date.now()
      const fileName = attachment.name || `file-${timestamp}`
      const filePath = `uploads/${timestamp}-${fileName}`

      onProgress?.(0.2)

      // Upload to storage
      const result = await storageService.uploadFile(attachment.uri, {
        bucket: 'attachments',
        path: filePath,
        onProgress: (progress) => {
          // Map storage progress to 20-90% range
          onProgress?.(0.2 + progress * 0.7)
        },
      })

      onProgress?.(0.95)

      if (!result.success) {
        throw new Error(result.error || 'Upload failed')
      }

      onProgress?.(1.0)

      // Return updated attachment metadata
      return {
        ...attachment,
        remoteUri: result.url,
        status: 'uploaded',
        progress: 1,
      }
    } catch (error) {
      console.error('[AttachmentService] Upload failed:', error)
      
      // Mark as failed but include error details
      return {
        ...attachment,
        status: 'failed',
        progress: 0,
      }
    }
  },

  /**
   * Delete an attachment from storage
   * @param remoteUri - Remote URI or cache key of the attachment
   */
  async delete(remoteUri: string): Promise<boolean> {
    try {
      // Extract path from remote URI if it's a Supabase URL
      if (remoteUri.includes('supabase')) {
        const url = new URL(remoteUri)
        const pathParts = url.pathname.split('/')
        const bucket = pathParts[pathParts.length - 2]
        const path = pathParts[pathParts.length - 1]
        
        return await storageService.deleteFile(bucket, path)
      }
      
      // Otherwise assume it's an AsyncStorage key
      return await storageService.deleteFile('attachments', remoteUri)
    } catch (error) {
      console.error('[AttachmentService] Delete failed:', error)
      return false
    }
  },
}
