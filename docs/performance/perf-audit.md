# Performance Audit Guide

This guide describes how to measure and audit performance in the BountyExpo mobile app.

## Prerequisites

- Node.js and npm installed
- Expo CLI installed (`npm install -g expo-cli`)
- React DevTools installed (`npm install -g react-devtools`)
- Physical device or emulator/simulator for testing

## Running the Performance Audit

### 1. Type Check

Ensure there are no TypeScript errors:

```bash
npx tsc --noEmit
```

Fix any errors before proceeding with performance testing.

### 2. Dependency Audit

Check for unused or missing dependencies:

```bash
npm run audit:deps
```

This runs `depcheck` to identify:
- Unused dependencies (can be removed to reduce bundle size)
- Missing dependencies (need to be added to package.json)
- Invalid devDependencies that should be dependencies

**Interpreting Results:**
- **Unused dependencies**: Review and remove if truly not needed (some may be used only in native code)
- **Missing dependencies**: Add to package.json if the audit is correct
- **False positives**: depcheck may flag dependencies used in JSX/TSX or native modules

### 3. Lint (if configured)

If the project has ESLint configured:

```bash
npm run lint
```

## Measuring Performance

### React Native Performance Monitor (Built-in)

1. Start the app: `npx expo start`
2. Open on device/emulator
3. **iOS**: Shake device → "Show Perf Monitor"
4. **Android**: Shake device or press Cmd+M (Mac) / Ctrl+M (Windows) → "Show Perf Monitor"

**Watch for:**
- **JS FPS**: Should stay close to 60. Below 30 indicates jank.
- **UI FPS**: Native UI thread performance.
- **RAM**: Memory usage over time (watch for steady increases).

### React DevTools Profiler

1. Install: `npm install -g react-devtools`
2. Run: `react-devtools`
3. Start app: `npx expo start`
4. The app should connect automatically
5. Click "Profiler" tab → "Start profiling"
6. Interact with the app (scroll lists, navigate screens)
7. Click "Stop profiling"

**Look for:**
- Components that render frequently (yellow/red in flame graph)
- Long render times (tall bars in ranked chart)
- Unnecessary re-renders of memoized components

### Chrome DevTools (Web Preview)

If testing on web:

1. Start app: `npx expo start --web`
2. Open Chrome DevTools (F12)
3. Go to Performance tab
4. Record and interact with app
5. Stop recording

**Check:**
- Frame rate (green line should be at 60fps)
- Long tasks (red bars indicate blocking operations)
- Memory timeline (shouldn't continuously grow)

### Flipper (Advanced)

For deeper profiling:

```bash
# Install expo-dev-client if needed
npx expo install expo-dev-client

# Build dev client
npx expo run:android
# or
npx expo run:ios
```

Then use [Flipper](https://fbflipper.com/) for:
- Network inspector
- Layout inspector
- Memory/CPU profiling
- React DevTools integration

## Test Scenarios

### Before/After Comparison

1. **Baseline Measurement (Before)**:
   - Clear app data/cache
   - Record FPS during scroll on heavy lists
   - Note memory usage at start and after 5 minutes
   - Document any visible jank or stuttering

2. **After Optimization**:
   - Repeat same steps
   - Compare metrics
   - Verify improvements

### Key Screens to Test

#### 1. Bounty List (Dashboard)
**Location**: Main screen (bounty tab)

**Test Steps**:
1. Navigate to bounty list
2. Ensure list has 50+ items (add test data if needed)
3. Start performance monitor
4. Rapidly scroll up and down for 30 seconds
5. Check FPS and memory

**Success Criteria**:
- JS FPS stays above 50
- No visible frame drops during scroll
- Memory usage stable (no leaks)

#### 2. Conversation List (Messenger)
**Location**: Messenger tab

**Test Steps**:
1. Navigate to conversations
2. Ensure 20+ conversations
3. Start performance monitor
4. Scroll through conversations
5. Open and close several chats

**Success Criteria**:
- Smooth transitions
- Avatar images load smoothly
- FPS stays above 50

#### 3. Portfolio Grid (Profile)
**Location**: Profile tab → Portfolio section

**Test Steps**:
1. Navigate to profile with portfolio items
2. Scroll through portfolio grid
3. Tap to open full-size images
4. Monitor memory usage

**Success Criteria**:
- Thumbnails load quickly in grid
- Full images load progressively in detail view
- No memory spikes when viewing full images

## Common Performance Issues

### Issue: Scroll Stuttering

**Symptoms**: Visible frame drops when scrolling lists

**Causes**:
- Inline render functions in FlatList
- Heavy computations in render
- Unoptimized images

**Solutions**:
- Extract renderItem to useCallback
- Memoize expensive computations
- Use OptimizedImage with thumbnails

### Issue: High Memory Usage

**Symptoms**: App memory grows continuously, crashes on low-memory devices

**Causes**:
- Full-resolution images in lists
- Memory leaks (event listeners not cleaned up)
- Large objects in state

**Solutions**:
- Use thumbnail URLs for list images
- Clean up subscriptions in useEffect
- Use OptimizedImage with proper caching

### Issue: Slow Initial Load

**Symptoms**: List takes long time to render initially

**Causes**:
- Too many items rendered at once (initialNumToRender too high)
- Synchronous data loading
- Large initial data fetch

**Solutions**:
- Reduce initialNumToRender (6-10 items)
- Implement pagination/infinite scroll
- Show loading states

### Issue: Layout Shifts

**Symptoms**: Content jumps around as images load

**Causes**:
- Missing image dimensions
- Dynamic content without placeholders

**Solutions**:
- Always specify width/height for images
- Use skeleton loaders
- Pre-calculate item heights

## Automation (Future)

Consider adding these to CI/CD:

```json
{
  "scripts": {
    "perf:audit": "npm run audit:deps && npx tsc --noEmit",
    "perf:size": "npx expo export --platform all && du -sh dist/",
    "perf:bundle": "npx react-native-bundle-visualizer"
  }
}
```

## Recommended Tools

- **React DevTools**: Component profiling
- **Flipper**: Network, layout, memory profiling
- **Expo Performance Monitor**: Quick FPS/memory check
- **depcheck**: Dependency audit
- **TypeScript**: Type safety
- **bundle-visualizer**: Analyze bundle size

## Performance Budget

Set and monitor these targets:

| Metric | Target | Critical |
|--------|--------|----------|
| Initial JS bundle | < 3MB | < 5MB |
| Time to Interactive | < 3s | < 5s |
| List scroll FPS | > 50 | > 30 |
| Memory (initial) | < 150MB | < 300MB |
| Memory (after 5min) | < 250MB | < 500MB |

## Reporting

When reporting performance issues, include:

1. **Device**: Model, OS version, RAM
2. **Metrics**: FPS, memory, load time
3. **Steps to reproduce**: Exact actions taken
4. **Expected vs Actual**: What should happen vs what happens
5. **Screenshots/Videos**: Visual evidence
6. **Profiler data**: React DevTools flame graph if applicable

## Resources

- [React Native Performance](https://reactnative.dev/docs/performance)
- [expo-image Documentation](https://docs.expo.dev/versions/latest/sdk/image/)
- [Optimizing Flatlist Configuration](https://reactnative.dev/docs/optimizing-flatlist-configuration)
- [PERFORMANCE.md](../PERFORMANCE.md) - Detailed optimization checklist
