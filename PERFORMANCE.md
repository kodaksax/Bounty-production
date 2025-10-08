# Performance Audit Checklist

This document provides a checklist for auditing and maintaining mobile performance in the BOUNTY Expo app.

## Image Optimization

### ✅ Completed
- [x] Added `expo-image` dependency for optimized image handling
- [x] Created `OptimizedImage` component with caching and thumbnailing
- [x] Updated Avatar component to use OptimizedImage
- [x] Implemented CDN-aware thumbnail URL generation

### 🔄 To Review
- [ ] Verify all Image components use OptimizedImage or expo-image
- [ ] Check that list row images use thumbnail mode (width/height specified)
- [ ] Ensure detail view images use full resolution (useThumbnail={false})
- [ ] Review image loading priorities (high/normal/low) based on importance

### 📝 Best Practices
1. **List Items**: Always specify `width` and `height` for thumbnails
   ```tsx
   <OptimizedImage source={uri} width={60} height={60} useThumbnail={true} priority="low" />
   ```

2. **Detail Views**: Use full resolution with high priority
   ```tsx
   <OptimizedImage source={uri} useThumbnail={false} priority="high" style={{...}} />
   ```

3. **Placeholders**: Provide fallback placeholders for better UX
   ```tsx
   <OptimizedImage source={uri} placeholder={defaultAvatar} onError={handleError} />
   ```

## List Optimization

### ✅ Completed
- [x] Optimized bounty-app.tsx main bounty list FlatList
- [x] Converted messenger-screen conversations from ScrollView.map to FlatList
- [x] Optimized sticky-message-interface chat FlatList
- [x] Extracted inline render functions to useCallback

### 🔄 To Review
- [ ] Convert postings-screen tab content lists to FlatList (currently uses .map())
- [ ] Verify all FlatList implementations have proper keyExtractor
- [ ] Check that renderItem, keyExtractor are not inline functions
- [ ] Ensure ItemSeparatorComponent is extracted (not inline)

### 📝 FlatList Performance Props

All heavy lists should include these optimizations:

```tsx
<FlatList
  data={items}
  keyExtractor={keyExtractorFunction}     // Not inline: item => item.id
  renderItem={renderItemFunction}         // Not inline: ({ item }) => <Component />
  ItemSeparatorComponent={SeparatorComponent}  // Not inline
  
  // Performance props
  removeClippedSubviews={true}            // Remove off-screen views
  maxToRenderPerBatch={10}                // Batch render size
  windowSize={5}                          // Pages to render: 5 = 2 above + 2 below + 1 visible
  initialNumToRender={10}                 // Initial items to render
  updateCellsBatchingPeriod={100}         // Update batching delay (ms)
  
  // Optional: if items have fixed height
  getItemLayout={(data, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  })}
/>
```

### Common Patterns

#### ✅ Good (Optimized)
```tsx
const renderItem = useCallback(({ item }) => (
  <MyComponent key={item.id} {...item} />
), [dependencies]);

const keyExtractor = useCallback((item) => item.id, []);

<FlatList
  data={items}
  renderItem={renderItem}
  keyExtractor={keyExtractor}
  removeClippedSubviews={true}
  {...performanceProps}
/>
```

#### ❌ Bad (Causes re-renders)
```tsx
<FlatList
  data={items}
  renderItem={({ item }) => <MyComponent {...item} />}  // Recreated every render!
  keyExtractor={(item) => item.id}                      // Recreated every render!
/>
```

## Memory Management

### Current Status
- [x] expo-image uses automatic memory-disk caching
- [x] OptimizedImage component prioritizes cache strategies
- [x] Thumbnail URLs reduce image payload size

### 🔄 To Monitor
- [ ] App memory usage on low-end devices (< 2GB RAM)
- [ ] Image cache size growth over time
- [ ] OOM crash rates in production analytics

### Tools
```bash
# Clear expo-image cache (development)
# Add to app settings or dev menu if needed
import { Image } from 'expo-image';
await Image.clearMemoryCache();
await Image.clearDiskCache();
```

## Animation Performance

### ✅ Completed
- [x] bounty-app header uses Animated.event with native driver where possible

### 🔄 To Review
- [ ] Verify all animations use `useNativeDriver: true` when possible
- [ ] Check for layout animations that might cause jank
- [ ] Profile scroll performance with Chrome DevTools

### 📝 Guidelines
- Use `useNativeDriver: true` for transforms and opacity
- Avoid animating layout properties (width, height, flex) - these can't use native driver
- Use `LayoutAnimation` carefully - can cause jank on Android

## JavaScript Bundle Size

### 🔄 Regular Tasks
- [ ] Run dependency audit monthly
- [ ] Review unused dependencies
- [ ] Check for duplicate packages in bundle

### Tools
```bash
# Analyze bundle size
npx expo start --no-dev --minify

# Audit dependencies
npm run audit-deps  # See script in package.json

# Find duplicate dependencies
npm ls <package-name>
```

## Testing Performance

### Manual Tests
1. **Scroll Performance**: 
   - Open bounty list with 50+ items
   - Scroll rapidly up and down
   - Check for dropped frames or stuttering

2. **Image Loading**:
   - Clear app cache
   - Open screens with many images
   - Verify smooth loading with placeholders

3. **Memory Pressure**:
   - Navigate between screens repeatedly
   - Check memory doesn't grow unbounded
   - Test on low-memory device if possible

### Metrics to Monitor
- [ ] FPS during scrolling (target: 60fps on flagship, 30fps minimum on budget)
- [ ] Time to first paint for image-heavy screens
- [ ] Memory usage baseline vs. peak
- [ ] App size (download + installed)

## Platform-Specific Considerations

### iOS
- [ ] Test on older devices (iPhone 8, iPhone X)
- [ ] Verify safe area handling with images
- [ ] Check memory warnings in Xcode

### Android
- [ ] Test on devices with 2GB RAM or less
- [ ] Verify RecyclerView performance (FlatList)
- [ ] Check for texture size warnings in Logcat

## Debugging Performance Issues

### Tools
1. **React DevTools Profiler**
   ```bash
   npm install -g react-devtools
   react-devtools
   ```

2. **Expo Performance Monitor**
   - Shake device > "Show Performance Monitor"
   - Watch for high JS thread usage

3. **Flipper** (for advanced debugging)
   ```bash
   npx expo install expo-dev-client
   # Then use Flipper for memory/network profiling
   ```

### Common Issues

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| Scroll stuttering | Inline render functions | Extract to useCallback |
| High memory usage | Full-size images in lists | Use OptimizedImage with thumbnails |
| Slow list mounting | Too many initial items | Reduce initialNumToRender |
| Layout shifts | Missing image dimensions | Specify width/height explicitly |

## Quarterly Review Checklist

- [ ] Run full TypeScript check: `npx tsc --noEmit`
- [ ] Audit dependencies: `npm run audit-deps`
- [ ] Profile app with React DevTools Profiler
- [ ] Test on low-end device
- [ ] Review bundle size trends
- [ ] Check production crash analytics for OOM errors
- [ ] Update this checklist based on findings

## Resources

- [React Native Performance](https://reactnative.dev/docs/performance)
- [Expo Image Documentation](https://docs.expo.dev/versions/latest/sdk/image/)
- [FlatList Performance Tips](https://reactnative.dev/docs/optimizing-flatlist-configuration)
- [JavaScript Profiling](https://reactnative.dev/docs/profiling)

---

**Last Updated**: {{ date }}  
**Next Review**: {{ date + 3 months }}
