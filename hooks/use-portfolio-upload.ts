import * as DocumentPicker from 'expo-document-picker'
import { useState } from 'react'
import { attachmentService } from '../lib/services/attachment-service'
import type { PortfolioItem } from '../lib/types'

export interface PortfolioUploadState {
  isPicking: boolean
  isUploading: boolean
  progress: number
  message?: string | null
}

export interface UsePortfolioUploadOptions {
  userId: string
  onUploaded?: (item: PortfolioItem) => void
  onError?: (error: Error) => void
}

/**
 * Unified picker + upload flow for portfolio items (images, videos, and files)
 */
export function usePortfolioUpload(options: UsePortfolioUploadOptions) {
  const { userId, onUploaded, onError } = options
  const [state, setState] = useState<PortfolioUploadState>({ isPicking: false, isUploading: false, progress: 0, message: null })

  const pickAndUpload = async () => {
    try {
      setState(s => ({ ...s, isPicking: true, message: null }))
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: '*/*', // accept all and infer type by mime
      })
      setState(s => ({ ...s, isPicking: false }))
      if (result.canceled) return

      const asset = result.assets?.[0]
      if (!asset) throw new Error('No file selected')

      // Prepare attachment metadata for the upload service
      const attachment = {
        id: `${Date.now()}`,
        name: asset.name || 'portfolio-item',
        uri: asset.uri,
        mimeType: asset.mimeType || undefined,
        size: asset.size || undefined,
        status: 'uploading' as const,
      }

      setState(s => ({ ...s, isUploading: true, progress: 0, message: 'Uploading…' }))
      const uploaded = await attachmentService.upload(attachment, {
        onProgress: (p: number) => setState(s => ({ ...s, progress: p })),
      })

      const mime = uploaded.mimeType || ''
      const type: PortfolioItem['type'] =
        mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file'

      const item: PortfolioItem = {
        id: `p${Date.now()}`,
        userId,
        type,
        url: uploaded.remoteUri || uploaded.uri,
        thumbnail: type === 'image' ? (uploaded.remoteUri || uploaded.uri) : undefined,
        name: uploaded.name,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.size,
        createdAt: new Date().toISOString(),
      }

      setState(s => ({ ...s, isUploading: false, message: 'Uploaded successfully' }))
      onUploaded?.(item)
      return item
    } catch (e: any) {
      const err = e instanceof Error ? e : new Error('Portfolio upload failed')
      setState(s => ({ ...s, isPicking: false, isUploading: false, message: err.message }))
      onError?.(err)
      return null
    }
  }

  return {
    ...state,
    pickAndUpload,
  }
}
