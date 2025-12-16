import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { ActionSheetIOS, Alert, Platform } from 'react-native'
import { storageService } from '../lib/services/storage-service'
import type { Attachment } from '../lib/types'
import { getFileInfo } from '../lib/utils/fs-utils'

export interface AttachmentUploadOptions {
  bucket?: string // Supabase storage bucket name
  folder?: string // Folder within bucket (e.g., 'bounties', 'profiles', 'proofs')
  allowedTypes?: 'all' | 'images' | 'videos' | 'documents'
  maxSizeMB?: number
  onUploaded?: (attachment: Attachment) => void
  onError?: (error: Error) => void
}

export interface AttachmentUploadState {
  isUploading: boolean
  isPicking: boolean
  progress: number
  error: string | null
  lastUploaded: Attachment | null
}

type PickSource = 'camera' | 'photos' | 'files'

/**
 * Unified hook for attachment uploads supporting camera, photo gallery, and file picker
 */
export function useAttachmentUpload(options: AttachmentUploadOptions = {}) {
  const {
    bucket = 'attachments',
    folder = 'uploads',
    allowedTypes = 'all',
    maxSizeMB = 10,
    onUploaded,
    onError,
  } = options

  const [state, setState] = useState<AttachmentUploadState>({
    isUploading: false,
    isPicking: false,
    progress: 0,
    error: null,
    lastUploaded: null,
  })

  const maxSizeBytes = maxSizeMB * 1024 * 1024

  /**
   * Show picker options and handle the selected source
   */
  const pickAttachment = async (source?: PickSource) => {
    try {
      setState((s) => ({ ...s, isPicking: true, error: null }))

      // If source not specified, show picker dialog
      let selectedSource: PickSource | null | undefined = source
      if (!selectedSource) {
        selectedSource = await showSourcePicker(allowedTypes)
        if (!selectedSource) {
          setState((s) => ({ ...s, isPicking: false }))
          return null
        }
      }

      let result: {
        uri: string
        name: string
        mimeType?: string
        size?: number
      } | null = null

      switch (selectedSource) {
        case 'camera':
          result = await pickFromCamera()
          break
        case 'photos':
          result = await pickFromPhotos()
          break
        case 'files':
          result = await pickFromFiles()
          break
      }

      if (!result) {
        setState((s) => ({ ...s, isPicking: false }))
        return null
      }

      // Validate file size
      if (result.size && result.size > maxSizeBytes) {
        const error = new Error(`File too large. Maximum size is ${maxSizeMB}MB`)
        setState((s) => ({ ...s, isPicking: false, error: error.message }))
        onError?.(error)
        Alert.alert('File Too Large', `Maximum file size is ${maxSizeMB}MB`)
        return null
      }

      setState((s) => ({ ...s, isPicking: false }))

      // Upload the attachment
      return await uploadAttachment(result)
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to pick attachment')
      setState((s) => ({ ...s, isPicking: false, isUploading: false, error: err.message }))
      onError?.(err)
      return null
    }
  }

  /**
   * Upload attachment to storage
   */
  const uploadAttachment = async (file: {
    uri: string
    name: string
    mimeType?: string
    size?: number
  }): Promise<Attachment | null> => {
    try {
      setState((s) => ({ ...s, isUploading: true, progress: 0, error: null }))

      const timestamp = Date.now()
      const fileName = file.name || `attachment-${timestamp}`
      const filePath = `${folder}/${timestamp}-${fileName}`

      const uploadResult = await storageService.uploadFile(file.uri, {
        bucket,
        path: filePath,
        onProgress: (progress) => {
          setState((s) => ({ ...s, progress }))
        },
      })

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'Upload failed')
      }

      const attachment: Attachment = {
        id: `att-${timestamp}`,
        name: fileName,
        uri: file.uri, // Keep local URI for immediate display
        remoteUri: uploadResult.url,
        mimeType: file.mimeType,
        size: file.size,
        status: 'uploaded',
        progress: 1,
      }

      setState((s) => ({
        ...s,
        isUploading: false,
        progress: 1,
        lastUploaded: attachment,
        error: null,
      }))

      onUploaded?.(attachment)

      return attachment
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Upload failed')
      setState((s) => ({
        ...s,
        isUploading: false,
        progress: 0,
        error: err.message,
      }))
      onError?.(err)
      Alert.alert('Upload Failed', err.message)
      return null
    }
  }

  /**
   * Clear error message
   */
  const clearError = () => {
    setState((s) => ({ ...s, error: null }))
  }

  /**
   * Reset state
   */
  const reset = () => {
    setState({
      isUploading: false,
      isPicking: false,
      progress: 0,
      error: null,
      lastUploaded: null,
    })
  }

  return {
    ...state,
    pickAttachment,
    clearError,
    reset,
  }
}

/**
 * Show native picker for selecting source (camera, photos, or files)
 */
async function showSourcePicker(allowedTypes: 'all' | 'images' | 'videos' | 'documents'): Promise<PickSource | null> {
  const options: string[] = []
  const sources: PickSource[] = []

  if (allowedTypes === 'all' || allowedTypes === 'images') {
    options.push('Take Photo')
    sources.push('camera')
    options.push('Choose from Photos')
    sources.push('photos')
  }
  
  if (allowedTypes === 'all' || allowedTypes === 'documents') {
    options.push('Choose File')
    sources.push('files')
  }

  options.push('Cancel')

  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
        },
        (buttonIndex) => {
          if (buttonIndex === options.length - 1) {
            resolve(null)
          } else {
            resolve(sources[buttonIndex])
          }
        }
      )
    } else {
      // On Android, show alert with buttons
      Alert.alert(
        'Add Attachment',
        'Choose a source',
        [
          ...sources.map((source, index) => ({
            text: options[index],
            onPress: () => resolve(source),
          })),
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => resolve(null),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(null) }
      )
    }
  })
}

/**
 * Pick from camera
 */
async function pickFromCamera(): Promise<{
  uri: string
  name: string
  mimeType?: string
  size?: number
} | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) {
    Alert.alert('Permission Required', 'Camera permission is required to take photos.')
    return null
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.8,
  })

  if (result.canceled) {
    return null
  }

  const asset = result.assets?.[0]
  if (!asset) {
    return null
  }

  // Get file size if possible
  let size: number | undefined
  try {
    const info = await getFileInfo(asset.uri)
    if (info && info.exists && typeof info.size === 'number') {
      size = info.size
    }
  } catch (e) {
    console.error('Failed to get file size:', e)
  }

  return {
    uri: asset.uri,
    name: `photo-${Date.now()}.jpg`,
    mimeType: 'image/jpeg',
    size,
  }
}

/**
 * Pick from photo library
 */
async function pickFromPhotos(): Promise<{
  uri: string
  name: string
  mimeType?: string
  size?: number
} | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    Alert.alert('Permission Required', 'Photo library permission is required.')
    return null
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    allowsEditing: false,
    quality: 0.8,
  })

  if (result.canceled) {
    return null
  }

  const asset = result.assets?.[0]
  if (!asset) {
    return null
  }

  // Get file size if possible
  let size: number | undefined
  try {
    const info = await getFileInfo(asset.uri)
    if (info && info.exists && typeof info.size === 'number') {
      size = info.size
    }
  } catch (e) {
    console.error('Failed to get file size:', e)
  }

  // Type-safe extraction of fileName with fallback
  const fileName = ('fileName' in asset ? (asset as any).fileName : undefined) || `media-${Date.now()}`
  const mimeType = asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg')

  return {
    uri: asset.uri,
    name: fileName,
    mimeType,
    size,
  }
}

/**
 * Pick from file system
 */
async function pickFromFiles(): Promise<{
  uri: string
  name: string
  mimeType?: string
  size?: number
} | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
  })

  if (result.canceled) {
    return null
  }

  const asset = result.assets?.[0]
  if (!asset) {
    return null
  }

  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
  }
}
