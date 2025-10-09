# Shared Components

## OptimizedImage

A performance-optimized image component using expo-image for better memory management, caching, and smoother list scrolling on mobile devices.

### Features

- **Automatic caching**: Memory and disk caching strategies
- **Thumbnail generation**: Optimized loading for list items
- **CDN-aware**: Automatic URL transformation for Cloudinary, Imgix, and generic CDNs
- **Low memory mode**: Optimized for resource-constrained devices
- **Placeholder support**: Smooth loading experience
- **Priority loading**: Control image loading priority

### Usage

#### List Items (Thumbnails)

Use for avatars, thumbnails, or any small images in lists:

```tsx
import { OptimizedImage } from 'lib/components/OptimizedImage';

<OptimizedImage 
  source={{ uri: user.avatarUrl }} 
  width={60} 
  height={60} 
  style={{ borderRadius: 30 }}
  useThumbnail={true}
  priority="low"
  alt={user.name}
/>
```

#### Detail Views (Full Resolution)

Use for hero images or full-size views:

```tsx
<OptimizedImage 
  source={{ uri: bounty.imageUrl }} 
  useThumbnail={false}
  style={{ width: '100%', height: 300 }}
  priority="high"
  alt={bounty.title}
/>
```

#### With Placeholder

```tsx
<OptimizedImage 
  source={{ uri: imageUrl }} 
  placeholder={require('@/assets/placeholder.png')}
  width={100}
  height={100}
  onError={() => console.log('Failed to load image')}
  onLoad={() => console.log('Image loaded')}
/>
```

### Performance Tips

1. **Always specify dimensions for list items**: This enables thumbnail optimization and prevents layout shifts
2. **Use appropriate priority**: 
   - `'low'`: Background images, non-critical content
   - `'normal'`: Most images (default)
   - `'high'`: Above-the-fold content, hero images
3. **Provide placeholders**: Improves perceived performance
4. **Disable thumbnails for detail views**: Use `useThumbnail={false}` for full-quality images

### CDN Support

OptimizedImage automatically detects and uses CDN resizing when available:

- **Cloudinary**: `w_100,h_100,c_fill,f_auto,q_auto`
- **Imgix**: `?w=100&h=100&fit=crop&auto=format,compress`
- **Generic**: Falls back to `?w=100&h=100` query parameters

### Migration Guide

#### From React Native Image

```tsx
// Before
import { Image } from 'react-native';
<Image source={{ uri: url }} style={styles.avatar} />

// After
import { OptimizedImage } from 'lib/components/OptimizedImage';
<OptimizedImage source={{ uri: url }} width={60} height={60} style={styles.avatar} />
```

#### From expo-image

```tsx
// Before
import { Image } from 'expo-image';
<Image source={{ uri: url }} contentFit="cover" style={styles.image} />

// After
import { OptimizedImage } from 'lib/components/OptimizedImage';
<OptimizedImage source={{ uri: url }} resizeMode="cover" style={styles.image} />
```

### See Also

- [expo-image documentation](https://docs.expo.dev/versions/latest/sdk/image/)
- [PERFORMANCE.md](../../PERFORMANCE.md) - Full performance optimization guide
