# React DevTools Profiling Guide

This guide explains how to profile and optimize React components in the BountyExpo app using React DevTools Profiler.

## Setup

### Install React DevTools

```bash
# Install globally
npm install -g react-devtools

# Or use npx
npx react-devtools
```

### Connect to Your App

1. Start your Expo app: `npx expo start`
2. Launch React DevTools: `react-devtools` (or `npx react-devtools`)
3. Open your app on a device/emulator
4. React DevTools should automatically connect

## Using the Profiler

### Start Profiling

1. Open React DevTools
2. Navigate to the **Profiler** tab
3. Click the **Record** button (red circle)
4. Interact with your app (scroll, navigate, etc.)
5. Click **Stop** to finish recording

### Analyzing Results

#### Flame Graph View

The Flame Graph shows component render times:

- **Color coding:**
  - Yellow/Orange: Slow renders (needs optimization)
  - Blue/Green: Fast renders (performing well)
  - Gray: Component didn't render

- **Width:** Represents how long a component took to render
- **Height:** Shows component hierarchy depth

#### Ranked View

Shows components sorted by render time:
- Focus on components at the top of the list
- Look for components that render frequently
- Identify components with high cumulative time

### Key Metrics

1. **Render Duration**: Total time spent rendering
2. **Commit Count**: Number of times component committed to DOM
3. **Props Changes**: Which props changed and triggered re-renders
4. **Why Did This Render?**: Shows the reason for re-render

## Common Performance Issues

### 1. Inline Functions in Props

❌ **Bad:**
```tsx
<FlatList
  data={items}
  renderItem={({ item }) => <Item data={item} />}
  keyExtractor={(item) => item.id}
/>
```

✅ **Good:**
```tsx
const renderItem = useCallback(({ item }) => <Item data={item} />, []);
const keyExtractor = useCallback((item) => item.id, []);

<FlatList
  data={items}
  renderItem={renderItem}
  keyExtractor={keyExtractor}
/>
```

### 2. Missing React.memo

❌ **Bad:**
```tsx
export function ExpensiveComponent({ data }) {
  // Heavy computations
  const result = expensiveOperation(data);
  return <View>...</View>;
}
```

✅ **Good:**
```tsx
export const ExpensiveComponent = React.memo(function ExpensiveComponent({ data }) {
  const result = useMemo(() => expensiveOperation(data), [data]);
  return <View>...</View>;
});
```

### 3. Expensive Computations Without useMemo

❌ **Bad:**
```tsx
function MyComponent({ items }) {
  const filtered = items.filter(item => item.active);
  const sorted = filtered.sort((a, b) => b.date - a.date);
  return <List data={sorted} />;
}
```

✅ **Good:**
```tsx
function MyComponent({ items }) {
  const sortedItems = useMemo(() => {
    return items
      .filter(item => item.active)
      .sort((a, b) => b.date - a.date);
  }, [items]);
  
  return <List data={sortedItems} />;
}
```

### 4. State Updates Causing Cascading Re-renders

❌ **Bad:**
```tsx
function Parent() {
  const [expanded, setExpanded] = useState({});
  
  return items.map(item => (
    <Item 
      key={item.id}
      expanded={expanded[item.id]}
      onToggle={() => setExpanded({...expanded, [item.id]: !expanded[item.id]})}
    />
  ));
}
```

✅ **Good:**
```tsx
const Item = React.memo(function Item({ id, expanded, onToggle }) {
  return <TouchableOpacity onPress={onToggle}>...</TouchableOpacity>;
});

function Parent() {
  const [expanded, setExpanded] = useState({});
  
  const handleToggle = useCallback((id) => {
    setExpanded(prev => ({...prev, [id]: !prev[id]}));
  }, []);
  
  return items.map(item => (
    <Item 
      key={item.id}
      id={item.id}
      expanded={expanded[item.id]}
      onToggle={handleToggle}
    />
  ));
}
```

## Profiling Workflow

### Before Optimization

1. **Identify Problem Screens:**
   - Postings feed with many items
   - Messenger with many conversations
   - Search results
   - Profile screens with images

2. **Record Baseline:**
   - Start profiler
   - Perform test scenario (e.g., scroll through 50 items)
   - Stop profiler
   - Note slow components and render times

3. **Document Issues:**
   - Screenshot flame graph
   - Note components taking >16ms (60fps threshold)
   - List components with many renders

### After Optimization

1. **Re-profile Same Scenario:**
   - Clear cache if needed
   - Repeat exact same test
   - Record results

2. **Compare Metrics:**
   - Render time reduction (target: 50%+ improvement)
   - Reduced re-render count
   - Improved flame graph colors

3. **Verify No Regressions:**
   - Test functionality still works
   - No visual glitches
   - No missing updates

## Top 5 Components to Profile

Based on code analysis, focus on these components:

### 1. MyPostingExpandable (1217 lines)
- **Location:** `components/my-posting-expandable.tsx`
- **Issues:** Large component, many state updates, complex conditionals
- **Profile:** Expand/collapse actions, status changes
- **Optimize:** Extract subcomponents, memoize renders, optimize callbacks

### 2. BountyDetailModal (903 lines)
- **Location:** `components/bountydetailmodal.tsx`
- **Issues:** Heavy component with attachments, profiles, messages
- **Profile:** Modal open/close, scrolling, attachment loading
- **Optimize:** Memoize heavy computations, lazy load sections

### 3. SearchScreen (942 lines)
- **Location:** `app/tabs/search.tsx`
- **Issues:** FlatList with filters, autocomplete, debouncing
- **Profile:** Search input, filter changes, results rendering
- **Optimize:** Memoize filter logic, optimize callbacks

### 4. PostingsScreen (1603 lines)
- **Location:** `app/tabs/postings-screen.tsx`
- **Issues:** Multiple tabs, forms, lists
- **Profile:** Tab switches, list scrolling, form interactions
- **Optimize:** Extract tab content, memoize renders

### 5. NotificationsBell (174 lines)
- **Location:** `components/notifications-bell.tsx`
- **Issues:** FlatList, no memoization, inline functions
- **Profile:** Opening dropdown, scrolling notifications
- **Optimize:** Add React.memo, optimize FlatList callbacks

## Performance Targets

### Render Time Goals
- **Simple components:** <5ms per render
- **List items:** <10ms per render
- **Complex modals:** <50ms initial render
- **Screen transitions:** <100ms

### FPS Goals
- **Smooth scrolling:** 60fps on flagship devices, 30fps minimum on budget
- **Animations:** 60fps
- **Touch response:** <100ms

### Memory Goals
- **App baseline:** <150MB
- **With images loaded:** <300MB
- **No memory leaks:** Stable over 5+ minutes

## Profiling Checklist

Before merging optimizations:

- [ ] Profile each optimized component before/after
- [ ] Screenshot flame graphs for comparison
- [ ] Verify render time improvements (>30% reduction)
- [ ] Test on both iOS and Android
- [ ] Check memory usage with DevTools Memory profiler
- [ ] Verify no functionality broken
- [ ] Document optimization patterns used
- [ ] Update component with performance comments

## Tools Integration

### Using with Flipper

For more advanced profiling:

```bash
# Install Flipper
brew install --cask flipper  # macOS
# Or download from https://fbflipper.com/

# Install dev client
npx expo install expo-dev-client

# Run with dev client
npx expo start --dev-client
```

Flipper provides:
- React DevTools integration
- Network inspector
- Memory profiler
- Layout inspector

### Using with Expo Dev Tools

Built-in performance monitor:

1. Shake device in development
2. Select "Show Performance Monitor"
3. Watch for:
   - JS frame rate
   - UI frame rate
   - Memory usage
   - Bridge calls

## Optimization Patterns Used in This PR

This PR implements these proven patterns:

1. **React.memo** for expensive leaf components
2. **useMemo** for expensive computations
3. **useCallback** for stable callback references
4. **FlatList optimizations** with proper callbacks
5. **Component extraction** to isolate re-renders
6. **Conditional rendering** to skip unnecessary work

## References

- [React DevTools Documentation](https://react.dev/learn/react-developer-tools)
- [React Performance Optimization](https://react.dev/learn/render-and-commit)
- [React Native Performance](https://reactnative.dev/docs/performance)
- [Expo Performance Best Practices](https://docs.expo.dev/guides/performance/)
