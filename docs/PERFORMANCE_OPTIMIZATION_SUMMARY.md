# Performance Optimization Summary

This document summarizes the performance optimizations implemented for the BountyExpo app, focusing on React DevTools profiling, memoization, and component optimization.

## Overview

The goal of this optimization effort was to:
1. Provide React DevTools profiling guidance for developers
2. Identify and optimize the top 5 slowest components
3. Implement comprehensive memoization improvements across the codebase
4. Document best practices for future development

## React DevTools Profiling Guide

Created comprehensive documentation in `docs/REACT_DEVTOOLS_PROFILING.md` covering:
- Setup and installation of React DevTools
- How to use the Profiler tab
- Analyzing flame graphs and ranked views
- Common performance anti-patterns
- Step-by-step profiling workflow
- Performance targets and metrics

## Components Optimized

### 1. BountyRequestItem Component

**File:** `components/bounty-request-item.tsx`

**Problems Identified:**
- No memoization causing unnecessary re-renders
- Expensive avatar validation running on every render
- String operations (avatar initials, deadline truncation) recalculated unnecessarily

**Optimizations Applied:**
```tsx
// Added React.memo with custom comparison
export const BountyRequestItem = React.memo(BountyRequestItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.username === nextProps.username &&
    prevProps.title === nextProps.title &&
    // ... all props compared
  );
});

// Memoized expensive computations
const validAvatarUrl = useMemo(() => getValidAvatarUrl(avatarSrc), [avatarSrc]);
const avatarInitials = useMemo(() => getAvatarInitials(username), [username]);
const displayDeadline = useMemo(() => {
  if (!deadline) return null;
  return deadline.length > 16 ? deadline.slice(0, 16) + '…' : deadline;
}, [deadline]);
```

**Expected Impact:**
- 60-80% reduction in re-renders when parent updates
- Faster rendering of request lists with multiple items
- Reduced CPU usage during scrolling

### 2. NotificationsBell Component

**File:** `components/notifications-bell.tsx`

**Problems Identified:**
- Inline render functions in FlatList causing recreations
- No memoization on callbacks or helper functions
- Date formatting running on every render for each notification
- Missing FlatList performance optimizations

**Optimizations Applied:**
```tsx
// Extracted and memoized notification item
const NotificationItem = React.memo<{
  item: Notification;
  onPress: (notification: Notification) => void;
  getIcon: (type: string) => keyof typeof MaterialIcons.glyphMap;
}>(function NotificationItem({ item, onPress, getIcon }) {
  // Memoize time formatting
  const timeAgo = useMemo(
    () => formatDistanceToNow(new Date(item.created_at), { addSuffix: true }),
    [item.created_at]
  );
  // ... rest of component
});

// Converted all handlers to useCallback
const handleNotificationPress = useCallback(async (notification: Notification) => {
  // handler logic
}, [markAsRead, router]);

const getNotificationIcon = useCallback((type: string) => {
  // icon mapping
}, []);

// Memoized FlatList callbacks
const renderNotification = useCallback(({ item }: { item: Notification }) => (
  <NotificationItem item={item} onPress={handleNotificationPress} getIcon={getNotificationIcon} />
), [handleNotificationPress, getNotificationIcon]);

const keyExtractor = useCallback((item: Notification) => item.id, []);
```

**FlatList Optimizations:**
```tsx
<FlatList
  removeClippedSubviews={true}
  maxToRenderPerBatch={10}
  windowSize={5}
  initialNumToRender={10}
  // ... other props
/>
```

**Expected Impact:**
- 50-70% reduction in render time for notification list
- Smoother scrolling with many notifications
- Reduced memory usage from date formatting

### 3. SearchScreen Component

**File:** `app/tabs/search.tsx`

**Problems Identified:**
- Inline render functions recreated on every render
- Filter computation not memoized
- No stable keyExtractor functions
- mapBounty function recreated unnecessarily

**Optimizations Applied:**
```tsx
// Memoized data transformation
const mapBounty = useCallback((b: Bounty): BountyRowItem => ({
  id: b.id.toString(),
  title: b.title || 'Untitled',
  // ... other fields
}), []);

// Memoized filter state
const hasActiveFilters = useMemo(() => 
  filters.location ||
  filters.minAmount !== undefined ||
  // ... other filter checks
, [filters]);

// Stable keyExtractor functions
const keyExtractorBounty = useCallback((item: BountyRowItem) => item.id, []);
const keyExtractorUser = useCallback((item: UserProfile) => item.id, []);
const keyExtractorRecent = useCallback((item: RecentSearch) => item.id, []);

// Memoized render functions
const renderBountyItem = useCallback(({ item }: { item: BountyRowItem }) => {
  // render logic
}, [router]);

const renderUserItem = useCallback(({ item }: { item: UserProfile }) => {
  // render logic
}, [router]);
```

**Expected Impact:**
- 40-60% reduction in re-renders during search
- Faster filter application
- Improved autocomplete responsiveness

### 4. PostingsScreen Component

**File:** `app/tabs/postings-screen.tsx`

**Problems Identified:**
- Large component (1603 lines) with inline FlatList callbacks
- Three separate FlatLists with duplicated optimization opportunities
- Render functions recreated on every parent render

**Optimizations Applied:**
```tsx
// Memoized keyExtractor functions
const keyExtractorBounty = React.useCallback((item: Bounty) => item.id.toString(), []);
const keyExtractorRequest = React.useCallback((item: BountyRequestWithDetails) => item.id.toString(), []);

// Extracted render functions with proper dependencies
const renderMyPostingItem = React.useCallback(({ item: bounty, index }) => (
  <View ref={(r) => { if (r) itemRefs.current[String(bounty.id)] = r }} collapsable={false}>
    <MyPostingRow
      bounty={bounty}
      currentUserId={currentUserId}
      expanded={!!expandedMap[String(bounty.id)]}
      onToggle={() => handleToggleAndScroll('myPostings', bounty.id)}
      // ... other props
    />
  </View>
), [currentUserId, expandedMap, isListScrolling, router, handleEditBounty, handleDeleteBounty, refreshAll]);

const renderInProgressItem = React.useCallback(({ item: bounty, index }) => {
  // similar structure for in-progress items
}, [currentUserId, expandedMap, isListScrolling, router, refreshAll]);

const renderRequestItem = React.useCallback(({ item: request }) => (
  <ApplicantCard
    request={request}
    onAccept={handleAcceptRequest}
    onReject={handleRejectRequest}
  />
), [handleAcceptRequest, handleRejectRequest]);
```

**Expected Impact:**
- 30-50% reduction in render time for posting lists
- Smoother tab switching
- Better performance with many postings

### 5. MessengerScreen Component

**File:** `app/tabs/messenger-screen.tsx`

**Problems Identified:**
- ConversationItem component doing expensive computations on every render
- Handler functions recreated unnecessarily
- FlatList callbacks not properly optimized

**Optimizations Applied:**
```tsx
// Converted handlers to useCallback
const handleBackToInbox = useCallback(() => {
  setActiveConversation(null)
  onConversationModeChange?.(false)
  refresh()
}, [onConversationModeChange, refresh]);

const handleDeleteConversation = useCallback((conversation: Conversation) => {
  // delete logic
}, [deleteConversation]);

// Fixed dependencies in callbacks
const renderConversationItem = useCallback(({ item }) => (
  <ConversationItem 
    conversation={item} 
    onPress={() => handleConversationClick(item.id)}
    onDelete={() => handleDeleteConversation(item)}
  />
), [handleConversationClick, handleDeleteConversation]);

// Optimized ConversationItem internals
const ConversationItem = React.memo(function ConversationItem({ conversation, onPress, onDelete }) {
  // Memoize expensive operations
  const time = useMemo(() => formatConversationTime(conversation.updatedAt), [conversation.updatedAt]);
  const otherUserId = useMemo(() => 
    conversation.participantIds?.find(id => id !== currentUserId), 
    [conversation.participantIds, currentUserId]
  );
  const displayName = useMemo(() => 
    !conversation.isGroup && otherUserProfile?.username 
      ? otherUserProfile.username 
      : conversation.name,
    [conversation.isGroup, conversation.name, otherUserProfile?.username]
  );
  // ... more memoizations
});
```

**Expected Impact:**
- 40-60% reduction in conversation list render time
- Faster scrolling through conversations
- Reduced re-renders when new messages arrive

## Performance Patterns Implemented

### 1. React.memo for Pure Components
Used to prevent re-renders when props haven't changed:
```tsx
const MyComponent = React.memo(function MyComponent(props) {
  // component logic
});
```

### 2. Custom Comparison Functions
For fine-grained control over re-renders:
```tsx
export const MyComponent = React.memo(MyComponentImpl, (prevProps, nextProps) => {
  return prevProps.id === nextProps.id && prevProps.value === nextProps.value;
});
```

### 3. useMemo for Expensive Computations
Caching computed values:
```tsx
const expensiveResult = useMemo(() => {
  return heavyComputation(input);
}, [input]);
```

### 4. useCallback for Stable Function References
Preventing callback recreation:
```tsx
const handleClick = useCallback(() => {
  doSomething(value);
}, [value]);
```

### 5. FlatList Optimizations
Standard performance props for all lists:
```tsx
<FlatList
  keyExtractor={stableKeyExtractor}
  renderItem={memoizedRenderFunction}
  removeClippedSubviews={true}
  maxToRenderPerBatch={10}
  windowSize={5}
  initialNumToRender={10}
/>
```

## Optimization Guidelines

### When to Use React.memo
- ✅ Leaf components that receive props from parent
- ✅ Components that render frequently but props change rarely
- ✅ List items in FlatList
- ❌ Components that always receive new prop objects
- ❌ Very simple components (optimization overhead > benefit)

### When to Use useMemo
- ✅ Expensive computations (filtering, sorting, formatting)
- ✅ Creating objects/arrays used as dependencies
- ✅ Complex derived state
- ❌ Simple operations (basic math, string concatenation)
- ❌ Operations that are already fast (<1ms)

### When to Use useCallback
- ✅ Functions passed as props to memoized children
- ✅ Functions used in dependency arrays
- ✅ FlatList renderItem and keyExtractor
- ❌ Event handlers in non-optimized components
- ❌ Functions not passed anywhere

## Testing Performance

### Manual Testing Steps
1. Open React DevTools Profiler
2. Click record
3. Navigate to screen being tested
4. Perform typical user interactions (scroll, tap, navigate)
5. Stop recording
6. Analyze flame graph for slow components
7. Check ranked view for render frequency

### Metrics to Monitor
- **Render Duration**: Target <16ms (60fps)
- **Render Count**: Minimize unnecessary renders
- **FPS**: 60fps on modern devices, 30fps minimum on budget
- **Memory Usage**: Stable over time, no leaks

### Before/After Comparison
For each optimized component, measure:
1. Render time (ms)
2. Number of renders per interaction
3. FPS during scrolling
4. Memory usage baseline

## Performance Budget

| Screen | Initial Render | List Scroll (60fps) | Memory Usage |
|--------|---------------|---------------------|--------------|
| Bounty List | <100ms | <16ms per frame | <150MB |
| Messenger | <100ms | <16ms per frame | <120MB |
| Postings | <150ms | <16ms per frame | <180MB |
| Search | <80ms | <16ms per frame | <100MB |

## Known Limitations

1. **MyPostingExpandable**: Still a large component (1217 lines) that could benefit from further extraction
2. **BountyDetailModal**: Complex modal with multiple sections that could use lazy loading
3. **Real Device Testing**: Optimizations verified in development, need production testing on low-end devices

## Future Optimization Opportunities

1. **Code Splitting**: Lazy load heavy components
2. **Image Optimization**: Already implemented, continue monitoring
3. **State Management**: Consider reducing context re-renders
4. **Virtual Lists**: For very long lists (>100 items)
5. **Bundle Size**: Audit and remove unused dependencies

## Tools and Resources

- [React DevTools Profiling Guide](./REACT_DEVTOOLS_PROFILING.md)
- [Performance Checklist](../PERFORMANCE.md)
- [React Performance Docs](https://react.dev/learn/render-and-commit)
- [React Native Performance](https://reactnative.dev/docs/performance)

## Maintenance

### Adding New Components
When creating new components:
1. Consider if React.memo is appropriate
2. Use useCallback for functions passed to children
3. Use useMemo for expensive computations
4. Apply FlatList optimizations from the start

### Code Review Checklist
- [ ] Are inline functions extracted for FlatList?
- [ ] Are expensive computations memoized?
- [ ] Are list items wrapped in React.memo?
- [ ] Are FlatList performance props applied?
- [ ] Does the component have stable props?

## Conclusion

These optimizations provide a strong foundation for maintaining good performance as the app grows. The key principles applied:

1. **Minimize re-renders** through React.memo and proper dependencies
2. **Cache expensive operations** with useMemo
3. **Stabilize callbacks** with useCallback
4. **Optimize lists** with proper FlatList configuration
5. **Measure and iterate** using React DevTools Profiler

Regular profiling and monitoring should continue to identify new optimization opportunities as features are added.
