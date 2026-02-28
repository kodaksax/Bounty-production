# BottomNav Integration Visual Summary

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  BountyApp (Root Container)                 │
│  ┌───────────────────────────────────────┐  │
│  │                                       │  │
│  │  Active Screen Content                │  │
│  │  (MessengerScreen, WalletScreen,      │  │
│  │   ProfileScreen, PostingsScreen,      │  │
│  │   Dashboard, etc.)                    │  │
│  │                                       │  │
│  │  ScrollView/FlatList with            │  │
│  │  paddingBottom: 100px (recommended)   │  │
│  │                                       │  │
│  │  ▼ ▼ ▼ Last item scrolls here ▼ ▼ ▼ │  │
│  └───────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  BottomNav (position: absolute)       │ │ ← Rendered ONCE
│  │  bottom: -50px, height: 120px         │ │   at root level
│  │  ├─ Create  ├─ Wallet  ├─ [Bounty]  │ │
│  │  ├─ Postings  ├─ Profile             │ │
│  └────────────────────────────────────────┘ │
│  ↑ 70px visible above screen bottom         │
└──────────────────────────────────────────────┘
```

## BottomNav Dimensions

```
                Screen Bottom (y=0)
┌───────────────────────────────────────────┐
│                                           │
│      Visible Nav Area (70px)             │  ← User sees this
│      ┌──────────────────────┐            │
│      │  Nav Icons & Buttons  │           │
│      └──────────────────────┘            │
│                                           │
└───────────────────────────────────────────┘
        ↓ (50px below screen edge)
┌───────────────────────────────────────────┐
│                                           │
│      Hidden Area (50px)                  │  ← Off-screen
│      (For layered effect)                │
│                                           │
└───────────────────────────────────────────┘

Total Height: 120px
Bottom Offset: -50px
Visible Height: 70px
```

## Padding Strategy by Screen Type

### ✅ Good: Standard Tab Screen
```tsx
<ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
  {/* Content */}
  <Item />
  <Item />
  <Item />  ← Last item + 30px breathing room above nav
</ScrollView>
```

### ✅ Better: With Safe Area Insets
```tsx
const insets = useSafeAreaInsets()

<ScrollView contentContainerStyle={{ 
  paddingBottom: BOTTOM_NAV_SAFE_PADDING + insets.bottom 
}}>
  {/* Content */}
</ScrollView>
```

### ✅ Best: With Sticky Bottom Actions
```tsx
const STICKY_ACTIONS_HEIGHT = 64
const totalPadding = BOTTOM_NAV_BASE_OFFSET + STICKY_ACTIONS_HEIGHT + insets.bottom

<ScrollView contentContainerStyle={{ paddingBottom: totalPadding }}>
  {/* Content */}
</ScrollView>

<View style={{ 
  position: 'absolute', 
  bottom: BOTTOM_NAV_BASE_OFFSET,
  paddingBottom: insets.bottom 
}}>
  {/* Sticky actions */}
</View>
```

### ❌ Wrong: No Bottom Padding
```tsx
<ScrollView>
  {/* Content */}
  <Item />
  <Item />
  <Item />  ← Last item hidden behind nav!
</ScrollView>
```

## Screen Padding Reference

| Screen | Padding | Status | Notes |
|--------|---------|--------|-------|
| BountyApp Dashboard | 160px | ✅ Excellent | Generous space |
| MessengerScreen | 96px | ✅ Good | Adequate clearance |
| WalletScreen | 100px | ✅ Improved | Now consistent |
| ProfileScreen | 140px | ✅ Excellent | Very comfortable |
| PostingsScreen | Dynamic | ✅ Excellent | Accounts for sticky actions |
| ChatDetailScreen | 140px | ✅ Excellent | Input bar + nav |
| SearchScreen | 100px | ✅ Improved | Now consistent |

## Safe Area Handling

```
iPhone with Notch:
┌──────────────────────┐
│  Status Bar (44px)   │ ← insets.top
├──────────────────────┤
│                      │
│   Safe Content Area  │
│                      │
├──────────────────────┤
│  BottomNav (70px)    │
├──────────────────────┤
│  Home Indicator      │ ← insets.bottom (34px)
└──────────────────────┘

Android without Notch:
┌──────────────────────┐
│  Status Bar (24px)   │ ← insets.top
├──────────────────────┤
│                      │
│   Safe Content Area  │
│                      │
├──────────────────────┤
│  BottomNav (70px)    │
└──────────────────────┘ ← insets.bottom (0px)
```

## Usage Examples

### Example 1: Simple Screen
```tsx
import { BOTTOM_NAV_SAFE_PADDING } from 'lib/constants/navigation'

export function MyScreen() {
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: BOTTOM_NAV_SAFE_PADDING }}>
      <Text>Content</Text>
    </ScrollView>
  )
}
```

### Example 2: With Safe Area
```tsx
import { BOTTOM_NAV_SAFE_PADDING } from 'lib/constants/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function MyScreen() {
  const insets = useSafeAreaInsets()
  
  return (
    <ScrollView contentContainerStyle={{ 
      paddingBottom: BOTTOM_NAV_SAFE_PADDING + insets.bottom 
    }}>
      <Text>Content</Text>
    </ScrollView>
  )
}
```

### Example 3: With Sticky Footer
```tsx
import { BOTTOM_NAV_BASE_OFFSET } from 'lib/constants/navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function MyScreen() {
  const insets = useSafeAreaInsets()
  const FOOTER_HEIGHT = 60
  
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ 
        paddingBottom: BOTTOM_NAV_BASE_OFFSET + FOOTER_HEIGHT + insets.bottom + 16 
      }}>
        <Text>Content</Text>
      </ScrollView>
      
      <View style={{ 
        position: 'absolute',
        bottom: BOTTOM_NAV_BASE_OFFSET,
        paddingBottom: insets.bottom,
        height: FOOTER_HEIGHT 
      }}>
        <Text>Sticky Footer</Text>
      </View>
    </View>
  )
}
```

## Common Patterns

### Pattern: FlatList
```tsx
<FlatList
  data={items}
  renderItem={renderItem}
  contentContainerStyle={{
    paddingHorizontal: 16,
    paddingBottom: BOTTOM_NAV_SAFE_PADDING
  }}
/>
```

### Pattern: ScrollView
```tsx
<ScrollView 
  contentContainerStyle={{ 
    paddingBottom: BOTTOM_NAV_SAFE_PADDING 
  }}
  showsVerticalScrollIndicator={false}
>
  {children}
</ScrollView>
```

### Pattern: Modal/Full-Screen Overlay
```tsx
// Modals that replace the entire screen don't need nav padding
// because they render on top and the nav is hidden

export function MyModal() {
  return (
    <View style={{ flex: 1, backgroundColor: '#059669' }}>
      <ScrollView>
        {/* No paddingBottom needed */}
      </ScrollView>
    </View>
  )
}
```

## Checklist for New Screens

When creating a new screen, ensure:

- [ ] Screen does NOT import or render `<BottomNav />`
- [ ] Scrollable content has `paddingBottom: 100` or uses `BOTTOM_NAV_SAFE_PADDING`
- [ ] On iOS, consider adding `insets.bottom` to padding
- [ ] If screen has fixed bottom elements, account for `BOTTOM_NAV_BASE_OFFSET`
- [ ] Test on both tall and short content to verify last item is visible
- [ ] Add comment explaining nav is provided by root: `{/* Bottom nav provided by BountyApp */}`

## Summary

✅ **Current State:** All screens properly configured  
✅ **Best Practice:** Use constants from `lib/constants/navigation.ts`  
✅ **Maintenance:** Audit document serves as reference for future development
