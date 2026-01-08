# Performance Optimization Quick Reference

Quick reference guide for the performance optimizations applied to BountyExpo.

## 📊 Optimization Results Summary

| Component | Lines | Optimizations Applied | Expected Improvement |
|-----------|-------|----------------------|---------------------|
| BountyRequestItem | 85 | React.memo + 3 useMemo | 60-80% fewer re-renders |
| NotificationsBell | 174 | Extracted subcomponent + 6 useCallback + useMemo | 50-70% faster renders |
| SearchScreen | 942 | 5 useCallback + 1 useMemo + 3 keyExtractors | 40-60% fewer re-renders |
| PostingsScreen | 1603 | 3 renderItem + 2 keyExtractor with useCallback | 30-50% faster lists |
| MessengerScreen | 424 | 7 useMemo + 4 useCallback in ConversationItem | 40-60% faster list |

## 🎯 Optimization Patterns Used

### Pattern 1: React.memo for List Items

**When to use:** List items that receive props but render the same output

```tsx
// ❌ Before - Re-renders on every parent update
export function ListItem({ id, title, onPress }) {
  return <TouchableOpacity onPress={onPress}><Text>{title}</Text></TouchableOpacity>;
}

// ✅ After - Only re-renders when props actually change
// Note: For React.memo to be effective, the parent must pass stable props.
// If onPress is recreated on every render, React.memo won't help.
export const ListItem = React.memo(function ListItem({ id, title, onPress }) {
  return <TouchableOpacity onPress={onPress}><Text>{title}</Text></TouchableOpacity>;
});

// 🎯 Parent component should memoize callbacks for React.memo to work
function Parent({ items }) {
  const handlePress = useCallback((id) => {
    doSomething(id);
  }, []);

  return items.map(item => (
    <ListItem key={item.id} id={item.id} title={item.title} onPress={handlePress} />
  ));
}

// ✅ Advanced - Custom comparison for fine control
// Omit onPress from comparison if parent memoizes it with useCallback
export const ListItem = React.memo(
  ListItemComponent,
  (prev, next) => prev.id === next.id && prev.title === next.title
);
```

### Pattern 2: useMemo for Expensive Computations

**When to use:** Filtering, sorting, formatting, or any operation taking >1ms

```tsx
// ❌ Before - Recomputes on every render
function Component({ items }) {
  const filtered = items.filter(i => i.active);
  const sorted = filtered.sort((a, b) => b.date - a.date);
  return <List data={sorted} />;
}

// ✅ After - Computes only when items change
function Component({ items }) {
  const sortedItems = useMemo(() => {
    return items
      .filter(i => i.active)
      .sort((a, b) => b.date - a.date);
  }, [items]);
  
  return <List data={sortedItems} />;
}
```

### Pattern 3: useCallback for Stable Functions

**When to use:** Functions passed to memoized children or used in dependency arrays

```tsx
// ❌ Before - New function instance on every render
function Parent() {
  const handleClick = (id) => doSomething(id);
  return items.map(item => <ChildComponent key={item.id} onPress={handleClick} />);
}

// ✅ After - Stable function reference
function Parent() {
  const handleClick = useCallback((id) => {
    doSomething(id);
  }, []);
  
  return items.map(item => <ChildComponent key={item.id} onPress={handleClick} />);
}
```

### Pattern 4: FlatList Optimization

**When to use:** All FlatList instances

```tsx
// ❌ Before - Inline functions, no performance props
<FlatList
  data={items}
  renderItem={({ item }) => <Item {...item} />}
  keyExtractor={(item) => item.id}
/>

// ✅ After - Extracted callbacks, performance props
const keyExtractor = useCallback((item) => item.id, []);
const renderItem = useCallback(({ item }) => <Item {...item} />, []);

<FlatList
  data={items}
  keyExtractor={keyExtractor}
  renderItem={renderItem}
  removeClippedSubviews={true}
  maxToRenderPerBatch={10}
  windowSize={5}
  initialNumToRender={10}
/>
```

### Pattern 5: Extract Subcomponents

**When to use:** Component has heavy computations or can benefit from isolation

```tsx
// ❌ Before - Everything in one component
function NotificationList({ items, onPress }) {
  return (
    <FlatList
      data={items}
      renderItem={({ item }) => (
        <TouchableOpacity onPress={() => onPress(item)}>
          <Text>{formatDistanceToNow(new Date(item.created_at))}</Text>
          <Text>{item.title}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

// ✅ After - Extracted memoized subcomponent
const NotificationItem = React.memo(function NotificationItem({ item, onPress }) {
  const timeAgo = useMemo(
    () => formatDistanceToNow(new Date(item.created_at)),
    [item.created_at]
  );
  
  return (
    <TouchableOpacity onPress={() => onPress(item)}>
      <Text>{timeAgo}</Text>
      <Text>{item.title}</Text>
    </TouchableOpacity>
  );
});

function NotificationList({ items, onPress }) {
  const renderItem = useCallback(
    ({ item }) => <NotificationItem item={item} onPress={onPress} />,
    [onPress]
  );
  
  return <FlatList data={items} renderItem={renderItem} />;
}
```

## 🔍 Real Examples from BountyExpo

### Example 1: BountyRequestItem

```tsx
// Before: No memoization, expensive operations every render
export function BountyRequestItem({ username, avatarSrc, deadline }) {
  const validAvatarUrl = getValidAvatarUrl(avatarSrc);
  const initials = getAvatarInitials(username);
  const displayDeadline = deadline?.length > 16 ? deadline.slice(0, 16) + '…' : deadline;
  
  return (/* JSX */);
}

// After: React.memo + useMemo for expensive operations
const BountyRequestItemComponent = ({ username, avatarSrc, deadline }) => {
  const validAvatarUrl = useMemo(() => getValidAvatarUrl(avatarSrc), [avatarSrc]);
  const initials = useMemo(() => getAvatarInitials(username), [username]);
  const displayDeadline = useMemo(() => {
    if (!deadline) return null;
    return deadline.length > 16 ? deadline.slice(0, 16) + '…' : deadline;
  }, [deadline]);
  
  return (/* JSX */);
};

export const BountyRequestItem = React.memo(BountyRequestItemComponent);
```

### Example 2: NotificationsBell

```tsx
// Before: Inline renderItem, no memoization
<FlatList
  data={notifications}
  renderItem={({ item }) => (
    <TouchableOpacity onPress={() => handlePress(item)}>
      <Text>{formatDistanceToNow(new Date(item.created_at))}</Text>
      <Text>{item.title}</Text>
    </TouchableOpacity>
  )}
  keyExtractor={item => item.id}
/>

// After: Extracted component + memoized callbacks
const NotificationItem = React.memo(function NotificationItem({ item, onPress }) {
  const timeAgo = useMemo(
    () => formatDistanceToNow(new Date(item.created_at)),
    [item.created_at]
  );
  
  return (
    <TouchableOpacity onPress={() => onPress(item)}>
      <Text>{timeAgo}</Text>
      <Text>{item.title}</Text>
    </TouchableOpacity>
  );
});

const renderItem = useCallback(({ item }) => (
  <NotificationItem item={item} onPress={handlePress} />
), [handlePress]);

const keyExtractor = useCallback((item) => item.id, []);

<FlatList
  data={notifications}
  renderItem={renderItem}
  keyExtractor={keyExtractor}
  removeClippedSubviews={true}
  maxToRenderPerBatch={10}
  windowSize={5}
/>
```

### Example 3: SearchScreen Filter Logic

```tsx
// Before: Recomputed every render
const hasActiveFilters = 
  filters.location ||
  filters.minAmount !== undefined ||
  filters.maxAmount !== undefined;

// After: Memoized
const hasActiveFilters = useMemo(() => 
  filters.location ||
  filters.minAmount !== undefined ||
  filters.maxAmount !== undefined,
  [filters]
);
```

## 📋 Optimization Checklist

Use this when adding new components or reviewing existing ones:

### For All Components
- [ ] Does this component receive props from parent?
- [ ] Does it re-render when props haven't changed?
- [ ] Are there expensive computations? (>1ms)
- [ ] Are there inline functions passed to children?

### For List Components
- [ ] Is renderItem a stable function (useCallback)?
- [ ] Is keyExtractor a stable function (useCallback)?
- [ ] Are performance props applied?
  - [ ] `removeClippedSubviews={true}`
  - [ ] `maxToRenderPerBatch={10}`
  - [ ] `windowSize={5}`
  - [ ] `initialNumToRender={10}`
- [ ] Are list items wrapped in React.memo?

### For Complex Components
- [ ] Can subcomponents be extracted?
- [ ] Are heavy operations memoized?
- [ ] Are callbacks stabilized with useCallback?
- [ ] Is derived state memoized?

## 🎓 Learning Resources

1. **Project Docs**
   - [React DevTools Profiling Guide](./REACT_DEVTOOLS_PROFILING.md)
   - [Performance Optimization Summary](./PERFORMANCE_OPTIMIZATION_SUMMARY.md)
   - [Main Performance Guide](../PERFORMANCE.md)

2. **External Resources**
   - [React Performance Docs](https://react.dev/learn/render-and-commit)
   - [React Native Performance](https://reactnative.dev/docs/performance)
   - [Expo Performance Best Practices](https://docs.expo.dev/guides/performance/)

## 🚫 Common Mistakes to Avoid

### Mistake 1: Overusing React.memo

```tsx
// ❌ Don't memo simple components
const Button = React.memo(({ onPress, label }) => (
  <TouchableOpacity onPress={onPress}>
    <Text>{label}</Text>
  </TouchableOpacity>
));

// ✅ Do memo list items or expensive components
const ComplexListItem = React.memo(({ data }) => {
  // Complex rendering logic
});
```

### Mistake 2: Incorrect Dependencies

```tsx
// ❌ Missing dependencies
const handleClick = useCallback(() => {
  doSomething(value); // value not in deps
}, []);

// ✅ Include all dependencies
const handleClick = useCallback(() => {
  doSomething(value);
}, [value]);
```

### Mistake 3: Premature Optimization

```tsx
// ❌ Memoizing simple operations
const doubled = useMemo(() => value * 2, [value]);

// ✅ Only memoize expensive operations
const filtered = useMemo(() => 
  largeArray.filter(item => item.active).sort((a, b) => b.date - a.date),
  [largeArray]
);
```

## 📈 Measuring Impact

### Before Optimization
1. Open React DevTools Profiler
2. Record interaction (scroll, tap, etc.)
3. Note:
   - Render time (ms)
   - Number of renders
   - Components that rendered

### After Optimization
1. Repeat same interaction
2. Compare metrics:
   - Render time reduced by X%
   - Render count reduced by Y%
   - Fewer yellow/red bars in flame graph

### Success Criteria
- [ ] Render time reduced by >30%
- [ ] Unnecessary re-renders eliminated
- [ ] 60fps achieved on modern devices
- [ ] No new functionality broken

## 🔧 Debugging Performance

If optimization doesn't help:

1. **Check dependencies** - Are they changing unexpectedly?
2. **Verify React.memo** - Is the comparison function correct?
3. **Profile again** - Identify new bottlenecks
4. **Check children** - Are child components also optimized?
5. **Consider context** - Is context causing re-renders?

## 📞 Getting Help

If you're unsure about an optimization:
1. Review this guide
2. Check the detailed docs (links above)
3. Profile before and after
4. Ask in code review
