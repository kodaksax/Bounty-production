# Visual Guide: Bounty Detail Modal Enhancements

## Layout Structure

```
┌─────────────────────────────────────────┐
│  BOUNTY HEADER                          │
│  [Share] [Report] [Close]               │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ Scrollable Content Area           │ │
│  │                                   │ │
│  │ [Avatar] Username                 │ │
│  │          Posted 2h ago            │ │
│  │                                   │ │
│  │ Bounty Title                      │ │
│  │ [$100] [2 mi away / Online]       │ │
│  │                                   │ │
│  │ Description                       │ │
│  │ Full bounty description text...   │ │
│  │                                   │ │
│  │ ┌─────────────────────────────┐   │ │
│  │ │ Additional Details (NEW!)   │   │ │
│  │ ├─────────────────────────────┤   │ │
│  │ │ 🕒 Timeline                 │   │ │
│  │ │    Complete within 2 weeks  │   │ │
│  │ │                             │   │ │
│  │ │ 🔧 Skills Required          │   │ │
│  │ │    React Native, TypeScript │   │ │
│  │ │                             │   │ │
│  │ │ 📍 Location                 │   │ │
│  │ │    Seattle, WA              │   │ │
│  │ │                             │   │ │
│  │ │ ⚡ Deadline (amber text!)   │   │ │
│  │ │    December 31, 2025        │   │ │
│  │ └─────────────────────────────┘   │ │
│  │                                   │ │
│  │ Attachments                       │ │
│  │ [📷 image.png] [→]                │ │
│  │ [📄 document.pdf] [→]             │ │
│  │                                   │ │
│  │ Contact                           │ │
│  │ [💬 Message Username]             │ │
│  │                                   │ │
│  └───────────────────────────────────┘ │
│                                         │
├─────────────────────────────────────────┤ ← NEW! Border separator
│  SPACING (16px) ← NEW! Was 0px         │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Apply for Bounty                 │ │ ← NEW! Enhanced styling
│  │  (with shadow)                    │ │
│  └───────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

## Detail Row Structure (NEW!)

### Standard Detail
```
┌─────────────────────────────────┐
│ [Icon] Label                    │
│        Value text               │
└─────────────────────────────────┘
```

### Urgent Detail (Deadline)
```
┌─────────────────────────────────┐
│ [🕐] ⚡ Deadline (AMBER COLOR)  │
│      December 31, 2025          │
│      (AMBER COLOR, bold)        │
└─────────────────────────────────┘
```

## Color Scheme

### Standard Colors
- Background: Emerald-600 (#059669)
- Header: Emerald-700 (#047857)
- Detail Container: Emerald-800/50 (semi-transparent)
- Text Labels: Emerald-300 (#a7f3d0)
- Text Values: Emerald-100 (#d1fae5)
- Button: Emerald-500 (#10b981)

### Urgent Colors (Deadline)
- Icon Color: Amber-400 (#fbbf24)
- Label Color: Amber-400 (#fbbf24)
- Value Color: Amber-400 (#fbbf24) with font-weight: 600

## Button Improvements

### Before
```
┌─────────────────────────────┐
│  Apply for Bounty           │  ← 12px padding
│  (no shadow, 8px radius)    │
└─────────────────────────────┘
    No spacing above
```

### After
```
    ─────────────────────────     ← Border separator
    16px spacing
┌─────────────────────────────┐
│  Apply for Bounty           │  ← 16px padding
│  (with shadow, 12px radius) │
└─────────────────────────────┘
```

## Notification Flow

### Application Notification
```
Hunter                      System                     Poster
  │                           │                          │
  │ Click "Apply"             │                          │
  ├──────────────────────────>│                          │
  │                           │                          │
  │                           │ Send Notification        │
  │                           ├─────────────────────────>│
  │                           │                          │
  │ Alert: Application        │                          │ 🔔 New Application!
  │ Submitted                 │                          │
  │<──────────────────────────┤                          │
```

### Acceptance Notification
```
Poster                      System                     Hunter
  │                           │                          │
  │ Accept Application        │                          │
  ├──────────────────────────>│                          │
  │                           │                          │
  │                           │ Create Escrow            │
  │                           │ Create Conversation      │
  │                           │ Send Notification        │
  │                           ├─────────────────────────>│
  │                           │                          │
  │ Alert: Request Accepted   │                          │ 🔔 Application Accepted!
  │<──────────────────────────┤                          │
```

## Edge Case Handling

### Bounty Already Taken
```
User clicks "Apply" on in_progress bounty
        │
        ▼
┌─────────────────────────────┐
│  ⚠️  Bounty Already Taken   │
│                             │
│  This bounty has already    │
│  been accepted by another   │
│  hunter.                    │
│                             │
│        [OK]                 │
└─────────────────────────────┘
```

### Self-Application Prevention
```
Poster tries to apply to own bounty
        │
        ▼
┌─────────────────────────────┐
│  ⚠️  Cannot Apply           │
│                             │
│  You cannot apply to your   │
│  own bounty.                │
│                             │
│        [OK]                 │
└─────────────────────────────┘
```

## Responsive Behavior

### With All Optional Fields
- Shows all 4 details (Timeline, Skills, Location, Deadline)
- Last detail has marginBottom: 0
- Container height adjusts automatically

### With Some Optional Fields
- Only shows populated fields
- Maintains consistent spacing
- Empty fields don't render

### With No Optional Fields
- Entire "Additional Details" section hidden
- Direct flow from Description to Attachments

## Attachment Display

Each attachment shows:
```
┌─────────────────────────────────┐
│ [📷] filename.png       [→]     │
│      1.2 MB                     │
└─────────────────────────────────┘
```

Icons vary by type:
- Images: 📷 (image icon)
- Documents: 📄 (description icon)
- Size displayed or "Unknown size"

## Mobile-First Design

- Touch targets optimized for thumb reach
- Proper safe area insets
- Scrollable content area
- Fixed button at bottom
- Haptic feedback on button press (system default)

## Accessibility Features

- Semantic role assignments
- Accessible labels for screen readers
- Proper contrast ratios (emerald/white)
- Tap targets meet minimum size requirements
- Focus indicators on interactive elements
