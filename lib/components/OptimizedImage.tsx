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
  let uri: string;
  
  if (typeof source === 'string') {
    uri = source;
  } else if ('uri' in source && source.uri) {
    uri = source.uri;
  } else {
    return '';
  }

  // If no dimensions specified or it's a local file, return as-is
  if (!width && !height) return uri;
  if (uri.startsWith('file://') || uri.startsWith('data:')) return uri;

  // For remote URLs, try to append thumbnail parameters
  // This works with many CDNs (Cloudinary, Imgix, etc.)
  try {
    const url = new URL(uri);
    
    // Detect common CDN patterns and append appropriate params
    if (url.hostname.includes('cloudinary')) {
      // Cloudinary transformation
      const parts = url.pathname.split('/');
      const uploadIndex = parts.indexOf('upload');
      if (uploadIndex !== -1 && width && height) {
        parts.splice(uploadIndex + 1, 0, `w_${Math.round(width)},h_${Math.round(height)},c_fill,f_auto,q_auto`);
        url.pathname = parts.join('/');
        return url.toString();
      }
    } else if (url.hostname.includes('imgix')) {
      // Imgix parameters
      if (width) url.searchParams.set('w', Math.round(width).toString());
      if (height) url.searchParams.set('h', Math.round(height).toString());
      url.searchParams.set('fit', 'crop');
      url.searchParams.set('auto', 'format,compress');
      return url.toString();
    }
    
    // Generic fallback: append w/h params (works with some services)
    if (width) url.searchParams.set('w', Math.round(width).toString());
    if (height) url.searchParams.set('h', Math.round(height).toString());
    return url.toString();
  } catch (e) {
    // If URL parsing fails, return original
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
    
    // Return source as-is for full resolution
    if (typeof source === 'string') {
      return { uri: source };
    }
    return source;
  }, [source, width, height, useThumbnail]);

  // Determine cache policy based on priority
  const cachePolicy = React.useMemo(() => {
    switch (priority) {
      case 'high':
        return 'memory-disk'; // Keep in memory and disk for instant access
      case 'low':
        return 'disk'; // Disk only to save memory
      default:
        return 'memory-disk'; // Default to both for good balance
    }
  }, [priority]);

  return (
    <Image
      source={imageSource}
      style={style}
      contentFit={resizeMode}
      placeholder={placeholder}
      cachePolicy={cachePolicy}
      priority={priority}
      accessible={!!alt}
      accessibilityLabel={alt}
      onError={onError}
      onLoad={onLoad}
      transition={200} // Smooth fade-in
      {...props}
    />
  );
});

OptimizedImage.displayName = 'OptimizedImage';

// Export the getThumbnailUrl helper for external use
export { getThumbnailUrl };
