import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { ActionSheetIOS, Platform } from 'react-native'
import { attachmentService } from '../lib/services/attachment-service'
import { generateVideoThumbnail, MAX_PORTFOLIO_ITEMS, portfolioService } from '../lib/services/portfolio-service'
import type { PortfolioItem } from '../lib/types'
import { cacheDirectory, copyTo, readAsBase64 } from '../lib/utils/fs-utils'
import { processImage } from '../lib/utils/image-utils'

export interface PortfolioUploadState {
  isPicking: boolean
  isUploading: boolean
  progress: number
  message?: string | null
}

export interface LastPickedAsset {
  id: string
  uri: string
  name?: string
  kind?: 'image' | 'video' | 'file'
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
  const [lastPicked, setLastPicked] = useState<LastPickedAsset | null>(null)

  const pickAndUpload = async () => {
    try {
      // Check if user can add more items before picking
      const canAdd = await portfolioService.canAddItem(userId)
      if (!canAdd) {
        setState(s => ({ ...s, message: `Maximum of ${MAX_PORTFOLIO_ITEMS} portfolio items allowed` }))
        setTimeout(() => setState(s => ({ ...s, message: null })), 3000)
        return null
      }

      setState(s => ({ ...s, isPicking: true, message: null }))

      // Present a native prompt (ActionSheet on iOS, simple choice on Android) to choose source
      let choice: 'photos' | 'files' | null = null

      if (Platform.OS === 'ios') {
        choice = await new Promise((resolve) => {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              options: ['Cancel', 'Photos or Videos', 'Files'],
              cancelButtonIndex: 0,
            },
            (buttonIndex) => {
              if (buttonIndex === 1) resolve('photos')
              else if (buttonIndex === 2) resolve('files')
              else resolve(null)
            }
          )
        })
      } else {
        // On Android and other platforms, fall back to a simple prompt via DocumentPicker first
        // We'll present a basic confirm via ImagePicker request - default to photos if permission exists
        // but allow users to pick files via the document picker in a second step if they cancel.
        // For simplicity, show a prompt using window.confirm is not available; default to showing a small
        // two-step flow: try ImagePicker permission and open media picker; if user cancels, open DocumentPicker.
        choice = 'photos'
      }

  let assetUri: string | undefined
  let mimeType: string | undefined
  let name: string | undefined
  let assetKind: string | undefined // 'image' | 'video' | undefined

  if (choice === 'photos') {
        // Request permissions and pick from media library
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (!permission.granted) {
          // Fall back to document picker
          choice = 'files'
        } else {
          const pickResult = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.All,
            allowsEditing: false,
            quality: 0.8,
          })
          // expo-image-picker v14+ uses `canceled` and `assets` array
            if ((pickResult as any).canceled || (pickResult as any).cancelled) {
            // If user cancelled media picker on Android, fall back to files
            choice = 'files'
          } else {
            // Normalize image-picker result: prefer assets[0].uri
            const assets = (pickResult as any).assets
            assetUri = assets?.[0]?.uri || (pickResult as any).uri
              // derive mime, kind and name heuristically
              // assets[0].type on expo-image-picker can be 'image' or 'video' (not full mime)
              assetKind = assets?.[0]?.type || (pickResult as any).type || undefined
              mimeType = assets?.[0]?.mimeType || assets?.[0]?.type || (pickResult as any).mimeType || (pickResult as any).type || undefined
              name = assets?.[0]?.fileName || (pickResult as any).fileName || assetUri?.split('/').pop()
              // Set optimistic preview so UI can show local image/video while uploading
              if (assetUri) {
                // On Android image-picker may return content:// URIs which some image loaders
                // don't accept. Copy to the app cache and use file:// URI for upload preview.
                if (assetUri.startsWith('content://')) {
                  try {
                    const cacheDir = cacheDirectory || ''
                    const dest = `${cacheDir}portfolio-${Date.now()}-${name || 'asset'}`
                    await copyTo(dest, assetUri)
                    assetUri = dest
                  } catch (e) {
                    console.warn('[usePortfolioUpload] failed to copy content uri:', e)
                  }
                }

                // For immediate preview, try to create a data URI for images (fast and reliable)
                let previewUri = assetUri
                try {
                  if ((assetKind && assetKind === 'image') || (mimeType && mimeType.startsWith('image/'))) {
                    const b64 = await readAsBase64(assetUri)
                    const mime = mimeType || 'image/jpeg'
                    previewUri = `data:${mime};base64,${b64}`
                  }
                } catch (e) {
                  // If base64 read fails, fallback to file URI
                  console.warn('[usePortfolioUpload] preview base64 failed:', e)
                  previewUri = assetUri
                }

                setLastPicked({ id: `local-${Date.now()}`, uri: previewUri, name, kind: assetKind === 'image' ? 'image' : assetKind === 'video' ? 'video' : undefined })
              }
          }
        }
      }

  if (choice === 'files') {
        const result = await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          multiple: false,
          type: '*/*',
        })
        setState(s => ({ ...s, isPicking: false }))
        if (result.canceled) return
        const asset = result.assets?.[0]
  if (!asset) throw new Error('No file selected')
  assetUri = asset.uri
  mimeType = asset.mimeType || undefined
  name = asset.name || undefined
  // Document picker won't provide assetKind; try to infer from mime or name
  assetKind = asset.mimeType?.startsWith('image/') ? 'image' : asset.mimeType?.startsWith('video/') ? 'video' : assetKind
        if (assetUri) {
          // DocumentPicker can return content URIs; ensure a cache copy for consistent preview
          if (assetUri.startsWith('content://')) {
            try {
              const cacheDir = cacheDirectory || ''
              const dest = `${cacheDir}portfolio-${Date.now()}-${name || 'asset'}`
              await copyTo(dest, assetUri)
              assetUri = dest
            } catch (e) {
              console.warn('[usePortfolioUpload] failed to copy document uri:', e)
            }
          }
          setLastPicked({ id: `local-${Date.now()}`, uri: assetUri, name, kind: assetKind === 'image' ? 'image' : assetKind === 'video' ? 'video' : 'file' })
        }
      }

      // If no assetUri decided yet (e.g., android media picker canceled), stop
      if (!assetUri) {
        setState(s => ({ ...s, isPicking: false }))
        return null
      }

      // Process images (compress and resize) before upload
      let processedUri = assetUri
      if (assetKind === 'image' || (mimeType && mimeType.startsWith('image/'))) {
        setState(s => ({ ...s, message: 'Processing image…' }))
        try {
          const processed = await processImage(assetUri, {
            maxWidth: 1920,
            maxHeight: 1080,
            maxFileSizeBytes: 500 * 1024, // 500KB
            quality: 0.8,
          })
          processedUri = processed.uri
        } catch (e) {
          console.warn('[usePortfolioUpload] image processing failed, using original:', e)
        }
      }

      // Generate video thumbnail if this is a video
      let videoThumbnailUri: string | undefined
      if (assetKind === 'video' || (mimeType && mimeType.startsWith('video/'))) {
        setState(s => ({ ...s, message: 'Generating thumbnail…' }))
        try {
          videoThumbnailUri = await generateVideoThumbnail(processedUri)
        } catch (e) {
          console.warn('[usePortfolioUpload] video thumbnail generation failed:', e)
        }
      }

      // Prepare attachment metadata for the upload service
      const attachment = {
        id: `${Date.now()}`,
        name: name || 'portfolio-item',
        uri: processedUri,
        mimeType: mimeType || undefined,
        size: undefined,
        status: 'uploading' as const,
      }

      setState(s => ({ ...s, isUploading: true, progress: 0, message: 'Uploading…' }))
      const uploaded = await attachmentService.upload(attachment, {
        onProgress: (p: number) => setState(s => ({ ...s, progress: p })),
      })

      const mime = uploaded.mimeType || ''
      // Determine type from mime OR assetKind (expo-image-picker may set assetKind to 'image'|'video')
      const type: PortfolioItem['type'] =
        (mime && mime.startsWith('image/')) || assetKind === 'image' || (name && /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(name || '')) ? 'image'
        : (mime && mime.startsWith('video/')) || assetKind === 'video' || (name && /\.(mp4|mov|mkv|webm|avi)$/i.test(name || '')) ? 'video'
        : 'file'

      // Determine thumbnail: use video thumbnail for videos, or image preview for images
      let thumbnailUri: string | undefined
      if (type === 'video' && videoThumbnailUri) {
        thumbnailUri = videoThumbnailUri
      } else if (type === 'image') {
        thumbnailUri = lastPicked?.uri || uploaded.uri || uploaded.remoteUri
      }

      // For the persisted item, use the uploaded.remoteUri/url for canonical access,
      // but keep the preview thumbnail (data URI or local file) if available so the UI can show it immediately.
      const item: PortfolioItem = {
        id: `p${Date.now()}`,
        userId,
        type,
        // use remoteUri for canonical URL when available, but keep local uri for thumbnail/preview
        url: uploaded.remoteUri || uploaded.uri,
        thumbnail: thumbnailUri,
        name: uploaded.name,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.size,
        createdAt: new Date().toISOString(),
      }

      setState(s => ({ ...s, isUploading: false, message: 'Uploaded successfully', isPicking: false }))
  onUploaded?.(item)
  // clear optimistic preview after successful upload
  setLastPicked(null)
      return item
    } catch (e: any) {
      const err = e instanceof Error ? e : new Error('Portfolio upload failed')
      setState(s => ({ ...s, isPicking: false, isUploading: false, message: err.message }))
      onError?.(err)
      // keep lastPicked so user can retry or see preview; alternatively clear
      // setLastPicked(null)
      return null
    }
  }

  return {
    ...state,
    lastPicked,
    pickAndUpload,
  }
}
