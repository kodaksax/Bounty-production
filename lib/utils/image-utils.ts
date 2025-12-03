import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Maximum dimensions for compressed images
 */
export const MAX_IMAGE_WIDTH = 1920;
export const MAX_IMAGE_HEIGHT = 1080;

/**
 * Maximum file size in bytes (500KB)
 */
export const MAX_FILE_SIZE_BYTES = 500 * 1024;

/**
 * Quality settings for compression
 */
export const DEFAULT_COMPRESS_QUALITY = 0.8;
export const MIN_COMPRESS_QUALITY = 0.3;

/**
 * Image processing options
 */
export interface ImageProcessOptions {
  /** Maximum width in pixels. Default: 1920 */
  maxWidth?: number;
  /** Maximum height in pixels. Default: 1080 */
  maxHeight?: number;
  /** Target file size in bytes. Default: 500KB */
  maxFileSizeBytes?: number;
  /** Initial compression quality (0-1). Default: 0.8 */
  quality?: number;
  /** Output format. Default: 'jpeg' */
  format?: 'jpeg' | 'png' | 'webp';
  /** Crop region (optional) */
  crop?: {
    originX: number;
    originY: number;
    width: number;
    height: number;
  };
}

/**
 * Processed image result
 */
export interface ProcessedImage {
  uri: string;
  width: number;
  height: number;
  base64?: string;
}

/**
 * Crops an image to the specified region
 * @param uri - Source image URI
 * @param crop - Crop region with originX, originY, width, and height
 * @returns Cropped image result
 */
export async function cropImage(
  uri: string,
  crop: { originX: number; originY: number; width: number; height: number }
): Promise<ProcessedImage> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
  };
}

/**
 * Resizes an image to fit within max dimensions while maintaining aspect ratio
 * @param uri - Source image URI
 * @param maxWidth - Maximum width in pixels
 * @param maxHeight - Maximum height in pixels
 * @returns Resized image result
 */
export async function resizeImage(
  uri: string,
  maxWidth: number = MAX_IMAGE_WIDTH,
  maxHeight: number = MAX_IMAGE_HEIGHT
): Promise<ProcessedImage> {
  // First get the original dimensions
  const original = await ImageManipulator.manipulateAsync(
    uri,
    [],
    { format: ImageManipulator.SaveFormat.JPEG }
  );

  const originalWidth = original.width;
  const originalHeight = original.height;

  // Check if resize is needed
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return {
      uri: original.uri,
      width: originalWidth,
      height: originalHeight,
    };
  }

  // Calculate new dimensions maintaining aspect ratio
  const widthRatio = maxWidth / originalWidth;
  const heightRatio = maxHeight / originalHeight;
  const ratio = Math.min(widthRatio, heightRatio);

  const newWidth = Math.round(originalWidth * ratio);
  const newHeight = Math.round(originalHeight * ratio);

  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: newWidth, height: newHeight } }],
    { format: ImageManipulator.SaveFormat.JPEG }
  );

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
  };
}

/**
 * Compresses an image to the specified quality
 * @param uri - Source image URI
 * @param quality - Compression quality (0-1)
 * @param format - Output format
 * @returns Compressed image result with base64 data for size estimation
 */
export async function compressImage(
  uri: string,
  quality: number = DEFAULT_COMPRESS_QUALITY,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg'
): Promise<ProcessedImage> {
  const saveFormat =
    format === 'png'
      ? ImageManipulator.SaveFormat.PNG
      : format === 'webp'
        ? ImageManipulator.SaveFormat.WEBP
        : ImageManipulator.SaveFormat.JPEG;

  const result = await ImageManipulator.manipulateAsync(
    uri,
    [],
    { compress: quality, format: saveFormat, base64: true }
  );

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    base64: result.base64,
  };
}

/**
 * Estimates the file size from base64 string
 * Base64 encoding increases size by ~33% (4:3 ratio), so to estimate
 * the original binary size, we reverse this: bytes ≈ base64Length * 3/4
 * @param base64 - Base64 encoded image data
 * @returns Estimated file size in bytes
 */
export function estimateFileSizeFromBase64(base64: string): number {
  // Reverse base64 expansion: original bytes ≈ base64Length * 3/4
  return Math.ceil((base64.length * 3) / 4);
}

/**
 * Processes an image with cropping, resizing, and compression
 * Ensures the final image is under the target file size
 * @param uri - Source image URI
 * @param options - Processing options
 * @returns Processed image result
 */
export async function processImage(
  uri: string,
  options: ImageProcessOptions = {}
): Promise<ProcessedImage> {
  const {
    maxWidth = MAX_IMAGE_WIDTH,
    maxHeight = MAX_IMAGE_HEIGHT,
    maxFileSizeBytes = MAX_FILE_SIZE_BYTES,
    quality = DEFAULT_COMPRESS_QUALITY,
    format = 'jpeg',
    crop,
  } = options;

  let currentUri = uri;

  // Step 1: Apply crop if specified
  if (crop) {
    const cropped = await cropImage(currentUri, crop);
    currentUri = cropped.uri;
  }

  // Step 2: Resize to max dimensions
  const resized = await resizeImage(currentUri, maxWidth, maxHeight);
  currentUri = resized.uri;

  // Step 3: Compress with quality, iterating if needed to meet size target
  let currentQuality = quality;
  let compressed = await compressImage(currentUri, currentQuality, format);

  // Iterate to reduce quality if file is still too large
  while (
    compressed.base64 &&
    estimateFileSizeFromBase64(compressed.base64) > maxFileSizeBytes &&
    currentQuality > MIN_COMPRESS_QUALITY
  ) {
    currentQuality -= 0.1;
    compressed = await compressImage(currentUri, currentQuality, format);
  }

  return {
    uri: compressed.uri,
    width: compressed.width,
    height: compressed.height,
    base64: compressed.base64,
  };
}

/**
 * Creates a square crop region centered on the image
 * Useful for avatar cropping
 * @param imageWidth - Original image width
 * @param imageHeight - Original image height
 * @returns Crop region for a centered square
 */
export function getCenteredSquareCrop(
  imageWidth: number,
  imageHeight: number
): { originX: number; originY: number; width: number; height: number } {
  const size = Math.min(imageWidth, imageHeight);
  const originX = Math.floor((imageWidth - size) / 2);
  const originY = Math.floor((imageHeight - size) / 2);

  return {
    originX,
    originY,
    width: size,
    height: size,
  };
}

/**
 * Processes an avatar image with square crop and compression
 * @param uri - Source image URI
 * @param targetSize - Target size for the avatar (default: 400px)
 * @returns Processed avatar image
 */
export async function processAvatarImage(
  uri: string,
  targetSize: number = 400
): Promise<ProcessedImage> {
  // First get original dimensions
  const original = await ImageManipulator.manipulateAsync(
    uri,
    [],
    { format: ImageManipulator.SaveFormat.JPEG }
  );

  // Calculate centered square crop
  const crop = getCenteredSquareCrop(original.width, original.height);

  // Process with square crop and resize to target
  return processImage(uri, {
    crop,
    maxWidth: targetSize,
    maxHeight: targetSize,
    quality: DEFAULT_COMPRESS_QUALITY,
    format: 'jpeg',
  });
}
