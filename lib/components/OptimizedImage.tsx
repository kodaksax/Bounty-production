/**
 * OptimizedImage Component
 * 
 * A performance-optimized image component using expo-image for better memory management,
 * caching, and smoother list scrolling on mobile devices.
 * 
 * Features:
 * - Automatic caching with memory and disk strategies
 * - Thumbnail generation for list items
 * - Low memory mode for resource-constrained devices
 * - Placeholder and error fallback support
 * - CDN-aware thumbnail URL generation
 */

import { Image, ImageContentFit, ImageSource, ImageStyle } from 'expo-image';
import React from 'react';
import { StyleProp } from 'react-native';

export interface OptimizedImageProps {
  /** Image source - can be a URL string or ImageSource object */
  source: string | ImageSource | { uri: string };
  /** Width of the image (used for thumbnail optimization) */
  width?: number;
  /** Height of the image (used for thumbnail optimization) */
  height?: number;
  /** Style object for the image */
  style?: StyleProp<ImageStyle>;
  /** Resize mode for the image */
  resizeMode?: ImageContentFit;
  /** Priority for loading (high priority loads first) */
  priority?: 'low' | 'normal' | 'high';
  /** Alternative text for accessibility */
  alt?: string;
  /** Whether to use thumbnail optimization (default: true for list items) */
  useThumbnail?: boolean;
  /** Placeholder image source while loading */
  placeholder?: string | ImageSource;
  /** Callback when image fails to load */
  onError?: () => void;
  /** Callback when image loads successfully */
  onLoad?: () => void;
  /** Additional props to pass to expo-image */
  [key: string]: any;
}

/**
 * Generates a thumbnail URL for CDN-hosted images
 * Appends query parameters for image resizing when supported
 */
function getThumbnailUrl(source: string | ImageSource | { uri: string }, width?: number, height?: number): string {
  // Extract URI string from various source formats
  let uri: string;
  if (typeof source === 'string') {
    uri = source;
  } else if (typeof source === 'object' && 'uri' in source) {
    uri = source.uri;
  } else {
    // For ImageSource objects without uri, return empty string
    return '';
  }

  // If no dimensions provided, return original URI
  if (!width && !height) {
    return uri;
  }

  try {
    const url = new URL(uri);
    
    // Cloudinary CDN detection and transformation
    if (uri.includes('cloudinary.com')) {
      const w = width ? `w_${width}` : '';
      const h = height ? `,h_${height}` : '';
      const transform = `${w}${h},c_fill,f_auto,q_auto`;
      return uri.replace(/\/upload\//, `/upload/${transform}/`);
    }
    
    // Imgix CDN detection
    if (uri.includes('imgix.net') || uri.includes('imgix.com')) {
      url.searchParams.set('fit', 'crop');
      url.searchParams.set('auto', 'format,compress');
      if (width) url.searchParams.set('w', width.toString());
      if (height) url.searchParams.set('h', height.toString());
      return url.toString();
    }
    
    // Generic query parameter approach for other CDNs
    if (width) url.searchParams.set('w', width.toString());
    if (height) url.searchParams.set('h', height.toString());
    
    return url.toString();
  } catch (e) {
    // If URL parsing fails, return original URI
    return uri;
  }
}

/**
 * OptimizedImage Component
 * 
 * Usage:
 * ```tsx
 * // For list items (thumbnail mode)
 * <OptimizedImage 
 *   source={{ uri: imageUrl }} 
 *   width={60} 
 *   height={60} 
 *   style={{ borderRadius: 30 }}
 * />
 * 
 * // For detail views (full resolution)
 * <OptimizedImage 
 *   source={{ uri: imageUrl }} 
 *   useThumbnail={false}
 *   style={{ width: '100%', height: 300 }}
 *   priority="high"
 * />
 * ```
 */
export const OptimizedImage = React.memo<OptimizedImageProps>(({
  source,
  width,
  height,
  style,
  resizeMode = 'cover',
  priority = 'normal',
  alt,
  useThumbnail = true,
  placeholder,
  onError,
  onLoad,
  ...props
}) => {
  // Determine the actual source to use
  const imageSource = React.useMemo(() => {
    if (!source) return undefined;
    
    // If using thumbnail mode and dimensions provided, optimize URL
    if (useThumbnail && (width || height)) {
      const thumbnailUri = getThumbnailUrl(source, width, height);
      return thumbnailUri ? { uri: thumbnailUri } : source;
    }
    
    // For non-thumbnail mode or no dimensions, use source as-is
    if (typeof source === 'string') {
      return { uri: source };
    }
    return source;
  }, [source, width, height, useThumbnail]);

  // Map priority to expo-image priority
  const imagePriority = priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'normal';

  return (
    <Image
      source={imageSource}
      placeholder={placeholder}
      contentFit={resizeMode}
      priority={imagePriority}
      style={style}
      onError={onError}
      onLoad={onLoad}
      // Enable caching for better performance
      cachePolicy="memory-disk"
      // Accessibility
      accessible={!!alt}
      accessibilityLabel={alt}
      {...props}
    />
  );
});

OptimizedImage.displayName = 'OptimizedImage';
