# Discovery UI Guide

## Visual Layout

### Bounty Dashboard with Filters

```
┌─────────────────────────────────────┐
│  BOUNTY                    $125.50  │  ← Header
├─────────────────────────────────────┤
│  🔍 Search bounties or users...     │  ← Search bar
├─────────────────────────────────────┤
│  💰 Crypto  📦 Remote  💳 High Pay  │  ← Category chips
│  ❤️ For Honor                       │  ← (Existing)
├─────────────────────────────────────┤
│  [Filters •]  [Sort: Newest]  [Map] │  ← NEW: FilterBar
├─────────────────────────────────────┤
│                                     │
│  ┌───────────────────────────────┐ │
│  │ Fix React Bug                 │ │
│  │ @Jon_Doe • $50 • 5 mi         │ │
│  │ Need help fixing a component  │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ Move Furniture                │ │
│  │ @Jane_Smith • $100 • 15 mi    │ │
│  │ Help moving a couch           │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ Code Review (For Honor)       │ │
│  │ @Dev_Master • Remote          │ │
│  │ Review my pull request        │ │
│  └───────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

### Filter Modal

```
┌─────────────────────────────────────┐
│  Filters & Sorting            [X]   │
├─────────────────────────────────────┤
│                                     │
│  Sort By                            │
│  [✨ Relevance] [🕐 Newest]         │
│  [💰 Highest Pay] [📍 Nearest]     │
│                                     │
│  Max Distance                       │
│  [5 mi] [10 mi] [25 mi] [50 mi]    │
│  [100 mi] [Any]                     │
│                                     │
│  Amount Range                       │
│  [$0-$25] [$25-$50] [$50-$100]     │
│  [$100-$500] [$500+] [Any]         │
│                                     │
│  Work Type                          │
│  [All] [Online] [In Person]        │
│                                     │
├─────────────────────────────────────┤
│  [Reset]      [Apply Filters]       │
└─────────────────────────────────────┘
```

### Map View (Beta)

```
┌─────────────────────────────────────┐
│  🗺️ Map View              [X]       │
├─────────────────────────────────────┤
│  ℹ️ Map view is in beta. Showing   │
│     grouped bounties by location.   │
├─────────────────────────────────────┤
│                                     │
│  ┌──────────────┐  ┌──────────────┐│
│  │📍 Seattle, WA│  │📍 Portland   ││
│  │ [2 bounties] │  │ [1 bounty]   ││
│  │• Fix React Bu│  │• Move Furni  ││
│  │• Garden Work │  │              ││
│  └──────────────┘  └──────────────┘│
│                                     │
│  ┌──────────────┐  ┌──────────────┐│
│  │📍 Remote     │  │📍 San Fran   ││
│  │ [1 bounty]   │  │ [1 bounty]   ││
│  │• Code Review │  │• Website Des ││
│  └──────────────┘  └──────────────┘│
│                                     │
├─────────────────────────────────────┤
│  💡 To enable full interactive map: │
│     Install react-native-maps       │
└─────────────────────────────────────┘
```

## UI States

### Filter Button States

**Default (No Active Filters)**
```
┌─────────────┐
│ 📋 Filters  │  ← Light emerald background
└─────────────┘
```

**Active Filters**
```
┌─────────────┐
│ 📋 Filters •│  ← Bright emerald, has dot badge
└─────────────┘
```

### Sort Button States

**Default (Relevance)**
```
┌──────────────────┐
│ ✨ Relevance     │  ← Light emerald
└──────────────────┘
```

**Active Sort**
```
┌──────────────────┐
│ 🕐 Newest        │  ← Bright emerald
└──────────────────┘
```

### Map Toggle

**List View (Default)**
```
┌─────────┐
│ 🗺️ Map  │  ← Light emerald
└─────────┘
```

**Map View Active**
```
┌─────────┐
│ 📋 List │  ← Bright emerald
└─────────┘
```

## Filter Chips in Modal

### Inactive Chip
```
┌──────────┐
│ $0-$25   │  ← Dark emerald bg, light text
└──────────┘
```

### Active Chip
```
┌──────────┐
│ $50-$100 │  ← Bright emerald bg, dark text
└──────────┘
```

## Interaction Flow

### Applying Filters

1. User taps "Filters" button
   ```
   [Filters] ──tap──> Modal opens
   ```

2. User selects filters
   ```
   Modal: Distance [25 mi] ✓
          Amount [$50-$100] ✓
          Work Type [Online] ✓
   ```

3. User taps "Apply Filters"
   ```
   Modal closes ──> List updates ──> Badge appears on button
   ```

4. List shows filtered results
   ```
   Only bounties matching:
   - Within 25 miles
   - $50-$100
   - Online work
   ```

### Changing Sort Order

1. User taps "Sort" button
   ```
   [Relevance] ──tap──> Modal opens
   ```

2. User selects sort option
   ```
   Modal: [Newest] ✓ selected
   ```

3. Results reorder immediately
   ```
   Bounties sorted by created_at DESC
   Button updates to "Newest"
   ```

### Toggling Map View

1. User taps "Map" button
   ```
   [Map] ──tap──> Map view appears
   ```

2. Map groups bounties
   ```
   Groups by location string
   Shows count per location
   ```

3. User taps location card
   ```
   Location ──tap──> Navigate to bounty detail
   ```

4. User closes map
   ```
   [List] or [X] ──tap──> Return to list view
   ```

## Color Scheme

### Primary Colors
- **Emerald 600**: `#059669` - Main background
- **Emerald 700**: `#047857` - Cards, darker sections
- **Emerald 500**: `#10b981` - Borders, accents
- **Emerald 200**: `#a7f3d0` - Light text
- **Emerald 100**: `#d1fae5` - Lighter text

### Active State
- **Bright Emerald**: `#6ee7b7` - Active buttons/chips
- **Dark Emerald**: `#052e1b` - Active text

### Semantic Colors
- **Red**: Error states, clear/reset
- **Amber**: Low balance warnings
- **Blue**: Info banners

## Typography

### Button Labels
- Font: System
- Size: 13px
- Weight: 600 (semibold)
- Color: `#d1fae5` (inactive), `#052e1b` (active)

### Modal Title
- Font: System
- Size: 20px
- Weight: 700 (bold)
- Color: `#ffffff`

### Section Titles
- Font: System
- Size: 15px
- Weight: 600 (semibold)
- Color: `#d1fae5`

### Option Text
- Font: System
- Size: 13px
- Weight: 500 (medium/normal)
- Color: `#d1fae5` (inactive), `#052e1b` (active)

## Spacing

### FilterBar
- Container padding: 16px horizontal, 8px vertical
- Button gap: 8px
- Button padding: 12px horizontal, 8px vertical
- Button border radius: 20px

### Modal
- Content padding: 20px
- Section margin: 24px bottom
- Option gap: 8px
- Footer padding: 16px vertical, 20px horizontal

### Option Chips
- Padding: 14px horizontal, 10px vertical
- Border radius: 16px
- Border width: 1px

## Responsive Behavior

### Mobile Portrait
- FilterBar scrolls horizontally if needed
- Modal fills bottom 85% of screen
- Options wrap to multiple rows

### Mobile Landscape
- FilterBar shows all buttons inline
- Modal fills bottom 85% of screen
- Options grid utilizes width

### Tablet/Web
- FilterBar inline with space
- Modal centered, max width 600px
- Options grid wider layout

## Accessibility

### Labels
- All buttons: `accessibilityRole="button"`
- Filter button: `accessibilityLabel="Open filters"`
- Sort button: `accessibilityLabel="Change sort order"`
- Map toggle: `accessibilityLabel="Toggle map view"`

### Navigation
- Modal dismissible via:
  - Close button
  - Back gesture (mobile)
  - Escape key (web)
  - Backdrop tap

### Color Contrast
- Active state: 7:1 ratio (AAA)
- Inactive state: 4.5:1 ratio (AA)
- Border contrast: 3:1 minimum

## Animation

### Transitions
- Modal slide-up: 300ms ease-out
- Filter apply: Instant
- List update: Cross-fade 200ms
- Map toggle: Fade 250ms

### Interactions
- Button press: Scale 0.95, 100ms
- Chip selection: Background transition 150ms
- Modal backdrop: Fade in/out 200ms

## Empty States

### No Results After Filter
```
┌─────────────────────────────────────┐
│           🔍                        │
│                                     │
│    No bounties match this filter    │
│                                     │
│         [Clear Filter]              │
└─────────────────────────────────────┘
```

### No Location Data (Map View)
```
┌─────────────────────────────────────┐
│           📍                        │
│                                     │
│  No bounties with locations         │
│                                     │
│  Bounties without location data     │
│  cannot be shown on the map         │
└─────────────────────────────────────┘
```

## Performance Indicators

### Loading States
- Initial load: Spinner with "Loading bounties..."
- Load more: "Loading more..." footer
- Refresh: Pull-to-refresh indicator

### Filter Changes
- Instant update (client-side)
- No loading state needed
- Smooth list animation

## Testing Checklist

- [ ] Filter button shows badge when filters active
- [ ] Sort button updates label on selection
- [ ] Map toggle switches between list/map
- [ ] Filters persist after app restart
- [ ] Honor bounties bypass amount filter
- [ ] Empty state shows when no results
- [ ] Modal dismisses on backdrop tap
- [ ] Reset clears all filters
- [ ] Multiple filters combine correctly
- [ ] Sorting respects active filters
