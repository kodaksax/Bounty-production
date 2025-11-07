import AsyncStorage from '@react-native-async-storage/async-storage'
import { decode } from 'base64-arraybuffer'
import * as FileSystem from 'expo-file-system'
import { createClient } from '@supabase/supabase-js'

const STORAGE_PREFIX = 'attachment-cache-'

// Initialize Supabase client for storage
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''

let supabaseClient: ReturnType<typeof createClient> | null = null

if (supabaseUrl && supabaseKey) {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseKey)
  } catch (e) {
    console.warn('[StorageService] Failed to initialize Supabase client:', e)
  }
}

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
        console.warn('[StorageService] Supabase not configured, using AsyncStorage fallback')
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

    let fileData: ArrayBuffer | string
    let contentType = 'application/octet-stream'

    // Handle different URI schemes
    if (fileUri.startsWith('data:')) {
      // Data URI (base64)
      const matches = fileUri.match(/^data:([^;]+);base64,(.+)$/)
      if (!matches) throw new Error('Invalid data URI')
      
      contentType = matches[1]
      const base64Data = matches[2]
      fileData = decode(base64Data)
    } else {
      // File URI - read as base64 then convert to ArrayBuffer
      // Use string literal 'base64' as type for better compatibility across expo-file-system versions
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: 'base64' as any, // expo-file-system types vary across versions
      })
      fileData = decode(base64)
      
      // Try to detect content type from file extension
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

    // Upload to Supabase Storage
    const { data, error } = await supabaseClient.storage
      .from(bucket)
      .upload(path, fileData, {
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

      // For data URIs, store directly
      if (fileUri.startsWith('data:')) {
        await AsyncStorage.setItem(cacheKey, fileUri)
        return {
          success: true,
          url: cacheKey,
          fallbackToLocal: true,
        }
      }

      // For file URIs, read as base64 and store as data URI
      // Use string literal 'base64' as type for better compatibility across expo-file-system versions
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: 'base64' as any, // expo-file-system types vary across versions
      })

      // Detect content type from file extension
      const ext = fileUri.split('.').pop()?.toLowerCase()
      const mimeTypes: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        pdf: 'application/pdf',
      }
      const contentType = (ext && mimeTypes[ext]) || 'application/octet-stream'

      const dataUri = `data:${contentType};base64,${base64}`
      await AsyncStorage.setItem(cacheKey, dataUri)

      return {
        success: true,
        url: cacheKey,
        fallbackToLocal: true,
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
