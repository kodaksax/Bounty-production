# Shared Components

## OptimizedImage

A performance-optimized image component that wraps `expo-image` for better memory management, caching, and mobile performance.

### Features

- **Automatic Caching**: Uses memory-disk caching strategy for fast image loading
- **Thumbnail Optimization**: Automatically requests smaller images for list items
- **CDN Integration**: Supports common CDN patterns (Cloudinary, Imgix) for on-the-fly resizing
- **Memory Efficient**: Configurable cache policies based on priority
- **Smooth Loading**: Built-in fade-in transition

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

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `source` | `string \| ImageSource \| { uri: string }` | Required | Image URL or source object |
| `width` | `number` | - | Width for thumbnail optimization |
| `height` | `number` | - | Height for thumbnail optimization |
| `style` | `StyleProp<ImageStyle>` | - | Style object for the image |
| `resizeMode` | `ImageContentFit` | `'cover'` | How image fits container |
| `priority` | `'low' \| 'normal' \| 'high'` | `'normal'` | Loading priority |
| `useThumbnail` | `boolean` | `true` | Whether to request thumbnail version |
| `placeholder` | `string \| ImageSource` | - | Placeholder shown while loading |
| `alt` | `string` | - | Accessibility label |
| `onError` | `() => void` | - | Error callback |
| `onLoad` | `() => void` | - | Load success callback |

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

### Caching

Images are cached using expo-image's caching system:
- **Memory-disk** (default): Fast access, persists between sessions
- **Disk only** (priority='low'): Saves memory on low-end devices
- **Memory-disk** (priority='high'): Aggressive caching for instant access

To clear cache (e.g., in settings):
```tsx
import { Image } from 'expo-image';

await Image.clearMemoryCache();
await Image.clearDiskCache();
```

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
