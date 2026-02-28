# Performance Testing Guide

## Overview
This guide covers how to measure and monitor performance in the BOUNTYExpo app.

## Performance Targets

### Loading Metrics
- **App Launch**: < 2 seconds (from tap to interactive)
- **Screen Transitions**: < 300ms (smooth 60fps)
- **API Response Time**: < 500ms (for most endpoints)
- **Image Loading**: Instant from cache, < 1s for first load

### UI Performance
- **Scroll Performance**: Consistent 60fps (16.67ms per frame)
- **Touch Response**: < 100ms (feels instant)
- **Animation Smoothness**: 60fps throughout

### Resource Usage
- **Bundle Size**: < 10MB
- **Memory Usage**: < 200MB for typical usage
- **Network Usage**: Optimized with caching

## Measuring Performance

### 1. Screen Load Times

Use the performance monitor utility to track screen load times:

```tsx
import { withScreenPerformance } from 'lib/utils/performance-monitor';

function MyScreen() {
  // Your screen component
  return <View>...</View>;
}

export default withScreenPerformance(MyScreen, 'MyScreen');
```

### 2. Component Render Performance

Track how long components take to render:

```tsx
import { useRenderPerformance } from 'lib/utils/performance-monitor';

function MyComponent() {
  useRenderPerformance('MyComponent');
  
  return <View>...</View>;
}
```

### 3. Async Operation Performance

Track API calls and other async operations:

```tsx
import { trackAsyncPerformance } from 'lib/utils/performance-monitor';

const fetchBounties = trackAsyncPerformance(
  'fetchBounties',
  async () => {
    const data = await bountyService.getAll();
    return data;
  }
);
```

### 4. React DevTools Profiler

Use React DevTools to identify slow renders:

1. Install React DevTools browser extension
2. Open DevTools in your browser
3. Select the "Profiler" tab
4. Click "Record" and interact with the app
5. Review the flame graph for slow components

### 5. Metro Bundle Analyzer

Analyze bundle size and identify large dependencies:

```bash
# Install the analyzer
npm install --save-dev react-native-bundle-visualizer

# Analyze the bundle
npx react-native-bundle-visualizer
```

This will open a visualization showing:
- Total bundle size
- Size of each module
- Largest dependencies
- Duplicate packages

## Common Performance Issues

### 1. Slow List Scrolling

**Symptoms**: Choppy scrolling, dropped frames
**Solutions**:
- Use FlatList performance props (windowSize, maxToRenderPerBatch)
- Memoize list item components with React.memo
- Use getItemLayout for fixed-height items
- Avoid inline functions in renderItem
- Use removeClippedSubviews={true}

### 2. Large Images

**Symptoms**: Slow image loading, high memory usage
**Solutions**:
- Use expo-image for automatic caching
- Use OptimizedImage component for thumbnails
- Implement proper image sizing (don't load full resolution when thumbnail is needed)
- Use CDN transformations when available

### 3. Memory Leaks

**Symptoms**: App crashes after extended use, increasing memory usage
**Solutions**:
- Clean up subscriptions in useEffect cleanup functions
- Remove event listeners when components unmount
- Avoid storing large objects in state unnecessarily
- Use WeakMap/WeakSet for object caching

### 4. Bundle Size

**Symptoms**: Slow app downloads, long initial load times
**Solutions**:
- Remove unused dependencies
- Use dynamic imports for large screens
- Check for duplicate dependencies
- Use bundle analyzer to identify large modules

## Performance Checklist

Before releasing:

- [ ] All FlatLists have performance optimizations
- [ ] Images use expo-image with proper sizing
- [ ] No console warnings about slow renders
- [ ] Bundle size is under target (< 10MB)
- [ ] App launches in < 2 seconds
- [ ] No memory leaks in extended usage
- [ ] Smooth scrolling at 60fps
- [ ] Touch interactions feel instant (< 100ms)

## Automated Performance Testing

### Setup (Future Enhancement)

```bash
# Install performance testing tools
npm install --save-dev @perf-profiler/profiler

# Run performance tests
npm run test:performance
```

### Continuous Monitoring

Performance metrics are logged in development mode. Review these logs regularly:
- Check for warnings about slow operations (> 1000ms)
- Monitor render times (should be < 16.67ms for 60fps)
- Watch for increasing memory usage

## Useful Commands

```bash
# Clear Metro cache (if experiencing stale code issues)
npx expo start --clear

# Profile app startup
npx react-native run-ios --configuration Release --profile

# Analyze bundle
npx react-native-bundle-visualizer

# Memory profiling (iOS)
# device-id: Find with `xcrun xctrace list devices`
# your-bundle-id: Found in app.json under expo.ios.bundleIdentifier
xcrun xctrace record --template 'Time Profiler' --device <device-id> --launch <your-bundle-id>

# Memory profiling (Android)
# your-package-name: Found in app.json under expo.android.package
adb shell am start -n <your-package-name>/.MainActivity --es profile true
```

## Resources

- [React Native Performance](https://reactnative.dev/docs/performance)
- [Expo Performance](https://docs.expo.dev/guides/performance/)
- [FlatList Performance](https://reactnative.dev/docs/optimizing-flatlist-configuration)
- [React DevTools Profiler](https://react.dev/reference/react/Profiler)
