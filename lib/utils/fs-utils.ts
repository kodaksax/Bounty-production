/*
 * Wrapper utilities for filesystem operations that prefer the new
 * File/Directory API when available but gracefully fall back to the
 * legacy expo-file-system implementation.
 */
import * as FS from 'expo-file-system';

type Info = { exists: boolean; size?: number }

export const cacheDirectory: string = (() => {
  const dir = (FS as any).cacheDirectory
  if (!dir) {
    // runtime without expo-file-system configured
    return ''
  }
  return dir
})()

export async function readAsBase64(uri: string): Promise<string> {
  // Prefer the File API when available
  try {
    const File = (FS as any).File
    if (File && typeof File.readAsStringAsync === 'function') {
      const enc = (File.EncodingType && File.EncodingType.Base64) || 'base64'
      return await File.readAsStringAsync(uri, { encoding: enc })
    }
  } catch {
    // fallthrough
  }

  // Try legacy module
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Legacy = require('expo-file-system/legacy') as any
    if (Legacy && typeof Legacy.readAsStringAsync === 'function') {
      return await Legacy.readAsStringAsync(uri, { encoding: 'base64' })
    }
  } catch {
    // ignore
  }

  // Fallback to top-level API if present
  if (typeof (FS as any).readAsStringAsync === 'function') {
    return await (FS as any).readAsStringAsync(uri, { encoding: 'base64' })
  }

  throw new Error('No readAsStringAsync implementation available on File or FileSystem')
}

export async function copyTo(dest: string, from: string): Promise<void> {
  try {
    const File = (FS as any).File
    if (File && typeof File.copyAsync === 'function') {
      await File.copyAsync({ from, to: dest })
      return
    }
  } catch {
    // fallthrough
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Legacy = require('expo-file-system/legacy') as any
    if (Legacy && typeof Legacy.copyAsync === 'function') {
      await Legacy.copyAsync({ from, to: dest })
      return
    }
  } catch {
    // fallthrough
  }

  if (typeof (FS as any).copyAsync === 'function') {
    await (FS as any).copyAsync({ from, to: dest })
    return
  }

  throw new Error('No copyAsync implementation available on File or FileSystem')
}

export async function getFileInfo(uri: string): Promise<Info> {
  try {
    const File = (FS as any).File
    if (File && typeof File.getInfoAsync === 'function') {
      return await File.getInfoAsync(uri)
    }
  } catch {
    // fallthrough
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Legacy = require('expo-file-system/legacy') as any
    if (Legacy && typeof Legacy.getInfoAsync === 'function') {
      return await Legacy.getInfoAsync(uri)
    }
  } catch {
    // fallthrough
  }

  if (typeof (FS as any).getInfoAsync === 'function') {
    return await (FS as any).getInfoAsync(uri)
  }

  throw new Error('No getInfoAsync implementation available on File or FileSystem')
}

/**
 * Write a base64-encoded string to a destination file and return the dest URI.
 */
export async function writeBase64ToFile(dest: string, base64: string): Promise<string> {
  try {
    const File = (FS as any).File
    if (File && typeof File.writeAsStringAsync === 'function') {
      await File.writeAsStringAsync(dest, base64, { encoding: (File.EncodingType && File.EncodingType.Base64) || 'base64' })
      return dest
    }
  } catch {
    // fallthrough
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Legacy = require('expo-file-system/legacy') as any
    if (Legacy && typeof Legacy.writeAsStringAsync === 'function') {
      await Legacy.writeAsStringAsync(dest, base64, { encoding: 'base64' })
      return dest
    }
  } catch {
    // fallthrough
  }

  if (typeof (FS as any).writeAsStringAsync === 'function') {
    await (FS as any).writeAsStringAsync(dest, base64, { encoding: 'base64' })
    return dest
  }

  throw new Error('No writeAsStringAsync implementation available on File or FileSystem')
}

export default {
  cacheDirectory,
  readAsBase64,
  copyTo,
  getFileInfo,
  writeBase64ToFile,
}

