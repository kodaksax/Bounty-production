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

    // Helper: Wraps a promise with a timeout to prevent indefinite hangs
    function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          timeoutId = null
          reject(new Error(errorMessage))
        }, timeoutMs)
      })

      const wrappedPromise = promise.finally(() => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      })

      return Promise.race([wrappedPromise, timeoutPromise])
    }

    // Helper: convert a URI to an ArrayBuffer for upload
    // OPTIMIZED: Use Promise.race with timeout to try multiple methods in parallel for faster conversion
    async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
      // Data URI case - handle directly
      if (uri.startsWith('data:')) {
        const matches = uri.match(/^data:([^;]+);base64,(.+)$/)
        if (!matches) throw new Error('Invalid data URI')
        // Set contentType from data URI
        contentType = matches[1]
        const base64Data = matches[2]
        return decode(base64Data)
      }

      // OPTIMIZATION: Try fetch and base64 methods in parallel with timeout protection
      // This eliminates sequential fallback delays and prevents indefinite hangs
      const methods = [
        // Method 1: Try fetch -> arrayBuffer (fastest if supported)
        withTimeout(
          (async () => {
            const res = await fetch(uri)
            if (typeof (res as any).arrayBuffer === 'function') {
              const ab = await (res as any).arrayBuffer()
              if (ab && (ab as ArrayBuffer).byteLength > 0) return ab as ArrayBuffer
            }
            throw new Error('arrayBuffer not available')
          })(),
          10000, // 10 second timeout
          'fetch->arrayBuffer timeout'
        ),
        
        // Method 2: Try fetch -> blob -> arrayBuffer (fallback for some RN versions)
        withTimeout(
          (async () => {
            const res = await fetch(uri)
            if (typeof (res as any).blob === 'function') {
              const blob = await (res as any).blob()
              if (blob && typeof (blob as any).arrayBuffer === 'function') {
                const ab = await (blob as any).arrayBuffer()
                if (ab && (ab as ArrayBuffer).byteLength > 0) return ab as ArrayBuffer
              }
            }
            throw new Error('blob->arrayBuffer not available')
          })(),
          10000, // 10 second timeout
          'fetch->blob->arrayBuffer timeout'
        ),
        
        // Method 3: Read as base64 and decode (slowest but most compatible)
        withTimeout(
          (async () => {
            const base64 = await readAsBase64(uri)
            return decode(base64)
          })(),
          15000, // 15 second timeout (slightly longer for slower method)
          'readAsBase64 timeout'
        ),
      ]

      // Race all methods - first successful one wins
      // Use Promise.any if available, otherwise use a polyfill that matches its semantics
      const promiseAny = <T>(promises: Promise<T>[]): Promise<T> => {
        // Native Promise.any (ES2021+) if available
        if (typeof Promise.any === 'function') {
          return Promise.any(promises)
        }

        // Polyfill: resolve on first fulfilled promise, reject only after all reject
        return new Promise<T>((resolve, reject) => {
          const total = promises.length
          if (total === 0) {
            // No promises to wait on
            reject(new Error('All promises were rejected'))
            return
          }

          let remaining = total
          const errors: any[] = new Array(total)

          promises.forEach((p, index) => {
            Promise.resolve(p).then(
              value => {
                // First fulfillment wins
                resolve(value)
              },
              err => {
                errors[index] = err
                remaining -= 1
                if (remaining === 0) {
                  // All promises rejected
                  reject(new Error(`All promises were rejected: ${errors.map(e => e?.message || 'Unknown').join(', ')}`))
                }
              }
            )
          })
        })
      }

      try {
        return await promiseAny(methods)
      } catch (e) {
        // All methods failed or timed out - try one more time with just base64
        console.error('[StorageService] All URI conversion methods failed, trying final base64 fallback:', e)
        try {
          const base64 = await withTimeout(
            readAsBase64(uri),
            20000, // 20 second final timeout
            'Final base64 read timeout'
          )
          return decode(base64)
        } catch (finalError) {
          console.error('[StorageService] Final base64 fallback also failed:', finalError)
          throw new Error(`Failed to convert URI to ArrayBuffer after all attempts: ${finalError instanceof Error ? finalError.message : 'Unknown error'}`)
        }
      }
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

    let arrayBuffer: ArrayBuffer
    try {
      arrayBuffer = await uriToArrayBuffer(fileUri)
      // Update progress after successful conversion
      onProgress?.(0.5)
    } catch (conversionError) {
      console.error('[StorageService] URI conversion failed:', conversionError)
      throw new Error(`Failed to prepare file for upload: ${conversionError instanceof Error ? conversionError.message : 'Unknown error'}`)
    }

    // Upload to Supabase Storage (ArrayBuffer upload) with timeout protection
    try {
      const { error } = await withTimeout(
        supabaseClient.storage
          .from(bucket)
          .upload(path, arrayBuffer as any, {
            contentType,
            upsert: true,
          }),
        30000, // 30 second timeout for upload
        'Supabase upload timeout'
      )

      onProgress?.(0.9)

      if (error) {
        throw error
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
    } catch (uploadError) {
      console.error('[StorageService] Supabase upload failed:', uploadError)
      throw new Error(`Upload to Supabase failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`)
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
