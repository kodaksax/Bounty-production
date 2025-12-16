import AsyncStorage from '@react-native-async-storage/async-storage'
import { decode } from 'base64-arraybuffer'
import { supabase as supabaseClient } from '../supabase'
import { cacheDirectory, copyTo, readAsBase64, writeBase64ToFile } from '../utils/fs-utils'

const STORAGE_PREFIX = 'attachment-cache-'

// Use shared supabase client exported from lib/supabase.ts. That client is
// configured to persist auth and will include the user's access token when
// signed in. This ensures uploads are performed as the authenticated user and
// conform to RLS policies that allow authenticated uploads.

export interface UploadOptions {
  bucket: string
  path: string
  onProgress?: (progress: number) => void
}

export interface UploadResult {
  success: boolean
  url?: string
  error?: string
  fallbackToLocal?: boolean
}

/**
 * Storage service that uses Supabase Storage as primary and AsyncStorage as fallback.
 * Handles file uploads, downloads, and caching.
 */
export const storageService = {
  /**
   * Upload a file to Supabase Storage or fall back to AsyncStorage
   * @param fileUri - Local file URI (file://, content://, or data URI)
   * @param options - Upload options including bucket and path
   * @returns Upload result with public URL or local cache key
   */
  async uploadFile(fileUri: string, options: UploadOptions): Promise<UploadResult> {
    const { bucket, path, onProgress } = options

    try {
      // If Supabase is configured, try uploading there first
      if (supabaseClient) {
        return await this._uploadToSupabase(fileUri, bucket, path, onProgress)
      } else {
        console.error('[StorageService] Supabase not configured, using AsyncStorage fallback')
        return await this._saveToAsyncStorage(fileUri, path)
      }
    } catch (error) {
      console.error('[StorageService] Upload failed, trying AsyncStorage fallback:', error)
      // Fallback to AsyncStorage if Supabase upload fails
      return await this._saveToAsyncStorage(fileUri, path)
    }
  },

  /**
   * Delete a file from storage
   * @param bucket - Storage bucket name
   * @param path - File path in the bucket
   */
  async deleteFile(bucket: string, path: string): Promise<boolean> {
    try {
      if (supabaseClient) {
        const { error } = await supabaseClient.storage.from(bucket).remove([path])
        if (error) throw error
        return true
      } else {
        // Delete from AsyncStorage
        const cacheKey = STORAGE_PREFIX + path
        await AsyncStorage.removeItem(cacheKey)
        return true
      }
    } catch (error) {
      console.error('[StorageService] Delete failed:', error)
      return false
    }
  },

  /**
   * Get public URL for a file in storage
   * @param bucket - Storage bucket name
   * @param path - File path in the bucket
   */
  getPublicUrl(bucket: string, path: string): string | null {
    if (!supabaseClient) {
      // Return AsyncStorage key as identifier
      return STORAGE_PREFIX + path
    }

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  },

  /**
   * Check if Supabase storage is available
   */
  isSupabaseAvailable(): boolean {
    return !!supabaseClient
  },

  /**
   * Private: Upload file to Supabase Storage
   */
  async _uploadToSupabase(
    fileUri: string,
    bucket: string,
    path: string,
    onProgress?: (progress: number) => void
  ): Promise<UploadResult> {
    if (!supabaseClient) {
      throw new Error('Supabase client not initialized')
    }

    onProgress?.(0.1)

    let contentType = 'application/octet-stream'

    // Helper: convert a URI to an ArrayBuffer for upload. Prefer fetch->arrayBuffer,
    // fall back to fetch->blob->arrayBuffer, then to readAsBase64 decode as last resort.
    async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
      // Data URI case
      if (uri.startsWith('data:')) {
        const matches = uri.match(/^data:([^;]+);base64,(.+)$/)
        if (!matches) throw new Error('Invalid data URI')
        // Set contentType from data URI
        contentType = matches[1]
        const base64Data = matches[2]
        return decode(base64Data)
      }

      // Try fetch -> arrayBuffer
      try {
        const res = await fetch(uri)
        if (typeof (res as any).arrayBuffer === 'function') {
          const ab = await (res as any).arrayBuffer()
          if (ab && (ab as ArrayBuffer).byteLength > 0) return ab as ArrayBuffer
        }

        // Try blob -> arrayBuffer
        if (typeof (res as any).blob === 'function') {
          try {
            const blob = await (res as any).blob()
            if (blob && typeof (blob as any).arrayBuffer === 'function') {
              const ab = await (blob as any).arrayBuffer()
              if (ab && (ab as ArrayBuffer).byteLength > 0) return ab as ArrayBuffer
            }
          } catch (e) {
            console.error('[StorageService] fetch->blob->arrayBuffer failed:', e)
          }
        }
      } catch (e) {
        console.error('[StorageService] fetch->arrayBuffer failed, falling back to base64:', e)
      }

      // Fallback: read as base64 and construct ArrayBuffer
      const base64 = await readAsBase64(uri)
      return decode(base64)
    }

    // Detect content type from file extension for non-data URIs
    if (!fileUri.startsWith('data:')) {
      const ext = fileUri.split('.').pop()?.toLowerCase()
      if (ext) {
        const mimeTypes: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          webp: 'image/webp',
          pdf: 'application/pdf',
          doc: 'application/msword',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          mp4: 'video/mp4',
          mov: 'video/quicktime',
        }
        contentType = mimeTypes[ext] || contentType
      }
    }

    onProgress?.(0.3)

    const arrayBuffer = await uriToArrayBuffer(fileUri)

    // Upload to Supabase Storage (ArrayBuffer upload)
    const { data, error } = await supabaseClient.storage
      .from(bucket)
      .upload(path, arrayBuffer as any, {
        contentType,
        upsert: true,
      })

    onProgress?.(0.9)

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`)
    }

    // Get public URL
    const publicUrl = this.getPublicUrl(bucket, path)
    if (!publicUrl) {
      throw new Error('Failed to get public URL')
    }

    onProgress?.(1.0)

    return {
      success: true,
      url: publicUrl,
    }
  },

  /**
   * Private: Save file to AsyncStorage as fallback
   */
  async _saveToAsyncStorage(fileUri: string, path: string): Promise<UploadResult> {
    try {
      const cacheKey = STORAGE_PREFIX + path

      // Ensure a cache directory base
      const cacheDir = cacheDirectory || ''
      const filename = path.split('/').pop() || `cached-${Date.now()}`
      const dest = `${cacheDir}${filename}`

      // If input is a data URI, write its decoded base64 to a file in cache
      if (fileUri.startsWith('data:')) {
        const matches = fileUri.match(/^data:([^;]+);base64,(.+)$/)
        if (!matches) throw new Error('Invalid data URI')
        const base64 = matches[2]
        // write base64 to dest
        await writeBase64ToFile(dest, base64)
        await AsyncStorage.setItem(cacheKey, dest)
        return {
          success: true,
          url: cacheKey,
          fallbackToLocal: true,
        }
      }

      // For file:// or content:// URIs, copy into cache directory
      try {
        await copyTo(dest, fileUri)
        await AsyncStorage.setItem(cacheKey, dest)
        return {
          success: true,
          url: cacheKey,
          fallbackToLocal: true,
        }
      } catch (copyErr) {
        // If copy fails, try to read as base64 and write
        try {
          const base64 = await readAsBase64(fileUri)
          await writeBase64ToFile(dest, base64)
          await AsyncStorage.setItem(cacheKey, dest)
          return {
            success: true,
            url: cacheKey,
            fallbackToLocal: true,
          }
        } catch (e) {
          // Let error propagate to outer catch
          throw e
        }
      }
    } catch (error) {
      console.error('[StorageService] AsyncStorage save failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save to AsyncStorage',
        fallbackToLocal: true,
      }
    }
  },

  /**
   * Retrieve a file from AsyncStorage
   */
  async getFromAsyncStorage(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key)
    } catch (error) {
      console.error('[StorageService] AsyncStorage get failed:', error)
      return null
    }
  },
}
