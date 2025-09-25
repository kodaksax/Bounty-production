import type { AttachmentMeta } from './database.types'

/**
 * Simulated attachment upload service.
 * In production extend to POST multipart/form-data to your API / storage (S3, etc.).
 */
export const attachmentService = {
  /**
   * Simulate an upload with progressive callbacks.
   * Replace with real fetch / presigned URL PUT.
   */
  async upload(
    attachment: AttachmentMeta,
    opts: { onProgress?: (p: number) => void } = {}
  ): Promise<AttachmentMeta> {
    const totalSteps = 8
    for (let i = 1; i <= totalSteps; i++) {
      await new Promise(r => setTimeout(r, 120))
      opts.onProgress?.(i / totalSteps)
    }
    // Simulated remote URL
    return {
      ...attachment,
      remoteUri: attachment.remoteUri || `https://files.example.com/${attachment.id}/${encodeURIComponent(attachment.name)}`,
      status: 'uploaded',
      progress: 1,
    }
  }
}
