# Loading & Empty States - Visual Guide

## 🎨 Emerald Theme Palette

```
Primary Background:  #059669 (emerald-600)
Skeleton Overlay:    rgba(4, 120, 87, 0.4) (emerald-700/40)
Empty State Icons:   #007423 (emerald-700)
Accent:              #10b981 (emerald-500)
Text Primary:        #ffffff (white)
Text Secondary:      #6ee7b7 (emerald-200)
```

## 📱 Screen States Overview

### PostingsScreen - 4 Tabs

#### Tab 1: New (Bounty Creation Form)
```
Loading: ✨ ActivityIndicator with spinner
Empty:   N/A (form always visible)
Refresh: N/A (not a list)
```

#### Tab 2: In Progress
```
Loading: ┌─────────────────────────┐
         │ [●] ████████            │
         │     ████ ███            │
         │     ████████████████    │
         │     ██████████ ████     │
         └─────────────────────────┘
         × 3 PostingCardSkeletons

Empty:   ┌─────────────────────────┐
         │         [📋]            │
         │   No Active Work        │
         │  You haven't applied... │
         │  ┌─────────────────┐   │
         │  │ Browse Bounties │   │
         │  └─────────────────┘   │
         └─────────────────────────┘

Refresh: ⟳ Pull-to-refresh enabled
```

#### Tab 3: My Postings
```
Loading: ┌─────────────────────────┐
         │ [●] ████████            │
         │     ████ ███            │
         └─────────────────────────┘
         × 3 PostingCardSkeletons

Empty:   ┌─────────────────────────┐
         │         [➕]            │
         │   No Postings Yet       │
         │  You haven't posted...  │
         │  ┌─────────────────┐   │
         │  │ Create Bounty   │   │
         │  └─────────────────┘   │
         └─────────────────────────┘

Refresh: ⟳ Pull-to-refresh enabled
```

#### Tab 4: Requests
```
Loading: ┌─────────────────────────┐
         │ [●] ████████            │
         │     ████████            │
         │     ████ ████           │
         │  [████]  [████]         │
         └─────────────────────────┘
         × 3 ApplicantCardSkeletons

Empty:   ┌─────────────────────────┐
         │         [📥]            │
         │   No Requests Yet       │
         │  When hunters apply...  │
         │  ┌─────────────────┐   │
         │  │ Post a Bounty   │   │
         │  └─────────────────┘   │
         └─────────────────────────┘

Refresh: ⟳ Pull-to-refresh enabled
```

---

### MessengerScreen

```
Loading: ┌─────────────────────────┐
         │ [●] ████████████        │
         │     ████████            │
         ├─────────────────────────┤
         │ [●] ████████████        │
         │     ████████            │
         └─────────────────────────┘
         × 5 ConversationItemSkeletons

Empty:   ┌─────────────────────────┐
         │         [💬]            │
         │ No Conversations Yet    │
         │  Start a conversation   │
         │  by applying to a...    │
         │  ┌─────────────────┐   │
         │  │ Browse Bounties │   │
         │  └─────────────────┘   │
         └─────────────────────────┘

Refresh: ⟳ Pull-to-refresh enabled
```

---

### WalletScreen

```
Payment Methods Loading:
┌─────────────────────────┐
│ [██] ████████           │
│      ████               │
├─────────────────────────┤
│ [██] ████████           │
│      ████               │
└─────────────────────────┘
× 2 PaymentMethodSkeletons

Transactions Empty:
┌─────────────────────────┐
│         [🧾]            │
│  No Transactions Yet    │
│  Your bounty trans...   │
│                         │
└─────────────────────────┘

Refresh: ⟳ Pull-to-refresh (wallet + payment methods)
```

---

### ProfileScreen

```
Loading: ┌─────────────────────────┐
         │       [●●●]             │
         │      ███████            │
         │       ██████            │
         │                         │
         │ ███  ███  ███           │
         │ ███  ███  ███           │
         └─────────────────────────┘
         ProfileSkeleton

Empty:   N/A (always has data)

Refresh: ⟳ Pull-to-refresh (auth + normalized profile)
```

---

## 🎯 Skeleton Component Hierarchy

```
skeleton-loaders.tsx
├── PostingCardSkeleton
│   ├── Header (avatar + name)
│   ├── Title
│   ├── Description (2 lines)
│   └── Footer (amount + location)
│
├── ConversationItemSkeleton
│   ├── Avatar (round)
│   ├── Header (name + time)
│   └── Message preview
│
├── TransactionItemSkeleton
│   ├── Icon (square)
│   ├── Content (title + subtitle)
│   └── Amount
│
├── ProfileSkeleton
│   ├── Avatar (large, centered)
│   ├── Name + Bio
│   └── Stats (3 columns)
│
├── PaymentMethodSkeleton
│   ├── Icon (card)
│   └── Content (card + date)
│
└── ApplicantCardSkeleton
    ├── Header (avatar + name)
    ├── Message (2 lines)
    └── Actions (2 buttons)
```

---

## ♿ Accessibility Features

### All Components Include:
- Proper `accessibilityRole` attributes
- Descriptive `accessibilityLabel` for actions
- Helpful `accessibilityHint` for buttons
- Screen reader friendly descriptions
- Minimum touch target sizes (44px)
- High contrast text (WCAG AA)

### Empty States:
```tsx
<EmptyState
  icon="chat-bubble-outline"
  title="No Conversations Yet"
  description="Start a conversation..."
  actionLabel="Browse Bounties"
  onAction={() => navigate('bounty')}
/>
```

### Pull-to-Refresh:
```tsx
<RefreshControl
  refreshing={isRefreshing}
  onRefresh={handleRefresh}
  tintColor="#ffffff"  // iOS spinner
  colors={['#10b981']} // Android spinner
  accessibilityLabel="Pull to refresh"
/>
```

---

## 🔄 Data Flow

```
User Action → Pull to Refresh
              ↓
         setIsRefreshing(true)
              ↓
         refreshData() // Context method
              ↓
         ┌─────────┴─────────┐
         ↓                   ↓
    API Call            Update State
         ↓                   ↓
         └─────────┬─────────┘
                   ↓
         setIsRefreshing(false)
                   ↓
         UI Updates with new data
```

---

## 🎭 Animation Timeline

### Skeleton Loader
```
0ms:  Render with opacity 0.4
      ↓
∞:    Pulse animation (fade 0.4 ↔ 0.6)
      ↓
500ms: Data arrives
      ↓
      Replace with actual content
```

### Empty State
```
0ms:  Icon scale 0
      Content opacity 0
      ↓
300ms: Icon scales to 1 (ease-out)
      ↓
500ms: Content fades to 1
      ↓
      User can interact
```

### Pull-to-Refresh
```
0px:   Normal state
       ↓
50px:  Pull threshold reached
       Spinner appears
       ↓
       Release gesture
       ↓
       Trigger refresh
       Show loading
       ↓
       Data loaded
       Hide spinner
       Snap back to 0px
```

---

## 📊 Performance Metrics

### Component Sizes
- PostingCardSkeleton: ~150 lines
- ConversationItemSkeleton: ~80 lines
- Other skeletons: ~60-100 lines each

### Bundle Impact
- Total new code: ~500 lines
- Gzipped size: ~2-3KB
- Runtime overhead: Minimal (static components)

### Render Performance
- Skeleton memoization: ✅
- FlatList optimization: ✅
- Avoid re-renders: ✅
- Lazy loading: N/A (static components)

---

## 🧪 Testing Matrix

| Screen | Skeleton | Empty | Refresh | Action Button |
|--------|----------|-------|---------|---------------|
| Postings (In Progress) | ✅ | ✅ | ✅ | ✅ |
| Postings (Requests) | ✅ | ✅ | ✅ | ✅ |
| Postings (My Postings) | ✅ | ✅ | ✅ | ✅ |
| Messenger | ✅ | ✅ | ✅ | ✅ |
| Wallet (Methods) | ✅ | ➖ | ✅ | ➖ |
| Wallet (Transactions) | ➖ | ✅ | ✅ | ➖ |
| Profile | ✅ | ➖ | ✅ | ➖ |

Legend: ✅ Implemented | ➖ Not applicable

---

## 🎨 Design Tokens

```typescript
// Emerald Theme Colors
const colors = {
  primary: '#059669',      // emerald-600
  primaryDark: '#047857',  // emerald-700
  primaryLight: '#10b981', // emerald-500
  accent: '#6ee7b7',       // emerald-200
  textPrimary: '#ffffff',
  textSecondary: '#d1fae5',
  overlay: 'rgba(4, 120, 87, 0.4)',
}

// Spacing
const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
}

// Typography
const typography = {
  heading: { fontSize: 20, fontWeight: 'bold' },
  body: { fontSize: 14, fontWeight: 'normal' },
  caption: { fontSize: 12, fontWeight: 'normal' },
}
```

---

## 📝 Code Examples

### Using Skeleton Loader
```tsx
import { PostingsListSkeleton } from 'components/ui/skeleton-loaders'

{isLoading ? (
  <View className="px-4 py-6">
    <PostingsListSkeleton count={3} />
  </View>
) : (
  <FlatList data={bounties} ... />
)}
```

### Using Empty State
```tsx
import { EmptyState } from 'components/ui/empty-state'

<EmptyState
  icon="work-outline"
  title="No Active Work"
  description="You haven't applied to any bounties yet."
  actionLabel="Browse Bounties"
  onAction={() => setActiveScreen('bounty')}
/>
```

### Adding Pull-to-Refresh
```tsx
import { RefreshControl } from 'react-native'

<FlatList
  data={items}
  refreshControl={
    <RefreshControl
      refreshing={isRefreshing}
      onRefresh={handleRefresh}
      tintColor="#ffffff"
      colors={['#10b981']}
    />
  }
  ...
/>
```

---

## 🚀 Implementation Success

✅ All requirements met  
✅ Consistent emerald theme  
✅ Excellent user experience  
✅ Accessible to all users  
✅ Performant and optimized  
✅ Well documented  
✅ Ready for production  
