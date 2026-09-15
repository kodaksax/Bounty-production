import type { AttachmentMeta } from './database.types'
import { storageService } from './storage-service'

/** Max length for the file-name segment of a generated storage path. */
const MAX_SANITIZED_FILE_NAME_LENGTH = 100

/**
 * Normalize a user/device-supplied file name into a safe storage object-key
 * segment. Buckets like `portfolio_pictures` scope write access to a
 * `${auth.uid()}/...` path prefix (see storage.objects RLS policies in
 * supabase/migrations/20260915050320_portfolio_items.sql) -- an
 * unsanitized name containing `/`, `..`, backslashes, or control characters
 * could otherwise produce unexpected nested keys under that prefix and
 * complicate storage policies/cleanup. Falls back to a generic name if
 * nothing safe remains.
 */
function sanitizeFileName(rawName: string): string {
  const collapsedWhitespace = rawName.replace(/\s+/g, ' ').trim()
  const stripped = collapsedWhitespace
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/[\/\\]/g, '-')
    .replace(/[^a-zA-Z0-9 ._-]/g, '')
    .replace(/^[.\s-]+/, '')

  const truncated = stripped.slice(0, MAX_SANITIZED_FILE_NAME_LENGTH)
  return truncated || 'file'
}

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
    opts: { onProgress?: (p: number) => void; bucket?: string; pathPrefix?: string } = {}
  ): Promise<AttachmentMeta> {
    const { onProgress, bucket = 'attachments', pathPrefix = 'uploads' } = opts

    try {
      onProgress?.(0.1)

      // Generate file path
      const timestamp = Date.now()
      const fileName = sanitizeFileName(attachment.name || `file-${timestamp}`)
      const filePath = `${pathPrefix}/${timestamp}-${fileName}`

      onProgress?.(0.2)

      // Upload to storage
      const result = await storageService.uploadFile(attachment.uri, {
        bucket,
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
      // Check if it's a Supabase URL by checking URL structure
      if (storageService.isSupabaseAvailable() && remoteUri.includes('/storage/v1/object/')) {
        // Extract bucket and path from Supabase storage URL
        const url = new URL(remoteUri)
        const pathParts = url.pathname.split('/')
        const objectIndex = pathParts.indexOf('object')
        if (objectIndex !== -1 && objectIndex < pathParts.length - 2) {
          const bucket = pathParts[objectIndex + 2]
          const path = pathParts.slice(objectIndex + 3).join('/')
          
          return await storageService.deleteFile(bucket, path)
        }
      }
      
      // Otherwise assume it's an AsyncStorage key
      return await storageService.deleteFile('attachments', remoteUri)
    } catch (error) {
      console.error('[AttachmentService] Delete failed:', error)
      return false
    }
  },
}
