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
 * Quality reduction settings for iterative compression
 */
export const QUALITY_STEP = 0.15; // Larger steps to reduce iterations
export const MAX_COMPRESSION_ITERATIONS = 4; // Prevent excessive processing
export const MIN_SIZE_REDUCTION_THRESHOLD = 0.05; // Early exit if <5% size reduction

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
 * @param originalDimensions - Optional pre-fetched dimensions to avoid redundant fetch
 * @returns Resized image result
 */
export async function resizeImage(
  uri: string,
  maxWidth: number = MAX_IMAGE_WIDTH,
  maxHeight: number = MAX_IMAGE_HEIGHT,
  originalDimensions?: { width: number; height: number }
): Promise<ProcessedImage> {
  // Use provided dimensions or fetch them (optimization: pass dimensions to avoid redundant fetch)
  let originalWidth: number;
  let originalHeight: number;
  
  if (originalDimensions) {
    originalWidth = originalDimensions.width;
    originalHeight = originalDimensions.height;
  } else {
    const original = await ImageManipulator.manipulateAsync(
      uri,
      [],
      { format: ImageManipulator.SaveFormat.JPEG }
    );
    originalWidth = original.width;
    originalHeight = original.height;
  }

  // Check if resize is needed
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    // If no dimensions were provided, we need to return the original with dimensions
    if (!originalDimensions) {
      const original = await ImageManipulator.manipulateAsync(
        uri,
        [],
        { format: ImageManipulator.SaveFormat.JPEG }
      );
      return {
        uri: original.uri,
        width: originalWidth,
        height: originalHeight,
      };
    }
    return {
      uri,
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
 * Uses binary search for optimal compression quality
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

  const saveFormat =
    format === 'png'
      ? ImageManipulator.SaveFormat.PNG
      : format === 'webp'
        ? ImageManipulator.SaveFormat.WEBP
        : ImageManipulator.SaveFormat.JPEG;

  // OPTIMIZATION: Combine crop + resize + initial compression into ONE operation
  // This eliminates intermediate file writes and redundant image loads
  const operations: any[] = [];
  
  if (crop) {
    operations.push({ crop });
  }
  
  // Calculate resize dimensions if needed
  // We need to get dimensions first if we have a crop, otherwise we can estimate
  let shouldResize = true;
  let resizeOp: any = null;
  
  if (crop) {
    // After crop, check if resize is needed
    const cropWidth = crop.width;
    const cropHeight = crop.height;
    
    if (cropWidth > maxWidth || cropHeight > maxHeight) {
      const widthRatio = maxWidth / cropWidth;
      const heightRatio = maxHeight / cropHeight;
      const ratio = Math.min(widthRatio, heightRatio);
      const newWidth = Math.round(cropWidth * ratio);
      const newHeight = Math.round(cropHeight * ratio);
      resizeOp = { resize: { width: newWidth, height: newHeight } };
      operations.push(resizeOp);
    }
  } else {
    // No crop - need to get original dimensions to calculate resize
    // We'll do this in the combined operation below
    shouldResize = false;
  }

  // Execute combined operations with initial compression
  let result = await ImageManipulator.manipulateAsync(
    uri,
    operations,
    { compress: quality, format: saveFormat, base64: true }
  );

  // If no crop was specified and we still need to check resize
  if (!crop && shouldResize === false) {
    if (result.width > maxWidth || result.height > maxHeight) {
      const widthRatio = maxWidth / result.width;
      const heightRatio = maxHeight / result.height;
      const ratio = Math.min(widthRatio, heightRatio);
      const newWidth = Math.round(result.width * ratio);
      const newHeight = Math.round(result.height * ratio);
      
      // Need to resize - do it now with compression
      result = await ImageManipulator.manipulateAsync(
        result.uri,
        [{ resize: { width: newWidth, height: newHeight } }],
        { compress: quality, format: saveFormat, base64: true }
      );
    }
  }

  // Check if we need further compression using binary search
  if (!result.base64) {
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
    };
  }

  let currentSize = estimateFileSizeFromBase64(result.base64);
  
  // If already under target, return immediately
  if (currentSize <= maxFileSizeBytes) {
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
      base64: result.base64,
    };
  }

  // OPTIMIZATION: Use binary search to find optimal quality faster
  // Instead of linear steps (0.8 -> 0.65 -> 0.5 -> 0.35)
  // Try: test both 0.65 and 0.45 in parallel, pick best
  let lowQuality = MIN_COMPRESS_QUALITY;
  let highQuality = quality;
  let bestResult = result;
  let iterations = 0;

  while (iterations < MAX_COMPRESSION_ITERATIONS && highQuality - lowQuality > 0.1) {
    // Try mid-point quality
    const midQuality = (lowQuality + highQuality) / 2;
    
    const compressed = await ImageManipulator.manipulateAsync(
      result.uri,
      [],
      { compress: midQuality, format: saveFormat, base64: true }
    );

    if (compressed.base64) {
      const size = estimateFileSizeFromBase64(compressed.base64);
      
      if (size <= maxFileSizeBytes) {
        // This quality works, try higher quality
        bestResult = compressed;
        lowQuality = midQuality;
        
        // If we're close enough to target, stop here
        if (size >= maxFileSizeBytes * 0.9) {
          break;
        }
      } else {
        // Size too large, try lower quality
        highQuality = midQuality;
        
        // Keep this result if it's better than current best (and both have base64)
        if (bestResult.base64 && size < estimateFileSizeFromBase64(bestResult.base64)) {
          bestResult = compressed;
        }
      }
    }
    
    iterations++;
  }

  return {
    uri: bestResult.uri,
    width: bestResult.width,
    height: bestResult.height,
    base64: bestResult.base64,
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
 * OPTIMIZED: Fetches dimensions once and reuses in processImage
 * @param uri - Source image URI
 * @param targetSize - Target size for the avatar (default: 400px)
 * @returns Processed avatar image
 */
export async function processAvatarImage(
  uri: string,
  targetSize: number = 400
): Promise<ProcessedImage> {
  // OPTIMIZATION: Get dimensions once with minimal processing
  const original = await ImageManipulator.manipulateAsync(
    uri,
    [],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );

  // Calculate centered square crop based on dimensions
  const crop = getCenteredSquareCrop(original.width, original.height);

  // Process with square crop and resize to target in one optimized pass
  // The processImage function now combines operations to reduce intermediate file writes
  return processImage(uri, {
    crop,
    maxWidth: targetSize,
    maxHeight: targetSize,
    quality: DEFAULT_COMPRESS_QUALITY,
    format: 'jpeg',
  });
}
