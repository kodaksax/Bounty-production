# BOUNTYExpo - Screenshot Guide for App Store Submission

## Overview

This guide identifies the 6 best screens to showcase BOUNTYExpo in the App Store, along with screenshot requirements and capture instructions.

---

## Screenshot Requirements

### iPhone Screen Sizes Required

| Device | Resolution | Required |
|--------|------------|----------|
| 6.7" Super Retina (iPhone 15 Pro Max) | 1290 x 2796 | ✅ Required |
| 6.5" Super Retina (iPhone 11 Pro Max) | 1242 x 2688 | ✅ Required |
| 5.5" Retina (iPhone 8 Plus) | 1242 x 2208 | ✅ Required |
| iPad Pro 12.9" (6th gen) | 2048 x 2732 | 📌 Optional |

### General Guidelines
- All screenshots must be PNG or JPEG
- No transparency allowed
- Screenshots should showcase key features
- Consider adding marketing text overlays for context
- Ensure status bar shows good signal and battery
- Use realistic, appealing sample data

---

## Recommended Screenshots (6 Total)

### Screenshot 1: Onboarding/Welcome Screen
**File Location:** `app/onboarding/carousel.tsx`

**Screen Description:**
- Welcome carousel with "Welcome to Bounty" messaging
- Shows the app's value proposition
- Features the target/bounty icon in a circular container
- Emerald green (#059669) background with white text

**Capture State:**
- First slide of the onboarding carousel
- Shows "Welcome to Bounty" title
- "The trusted marketplace for getting things done..." description
- Navigation dots at bottom
- "Next" button visible

**Marketing Text Suggestion:**
> "Your trusted marketplace for getting things done"

---

### Screenshot 2: Bounty Feed/Discovery
**File Location:** `app/tabs/bounty-app.tsx`

**Screen Description:**
- Main dashboard showing available bounties
- Collapsing header with BOUNTY branding and wallet balance
- Search bar for discovering bounties/users
- Filter chips: Crypto, Remote, High Paying, Distance, For Honor
- "Trending This Week" horizontal carousel
- Bounty list cards showing title, price, distance

**Capture State:**
- Scroll position at top (header expanded)
- Several bounty items visible in the list
- At least 2-3 trending bounties visible
- Show varied bounty types (paid and "For Honor")
- Bottom navigation visible

**Marketing Text Suggestion:**
> "Discover local opportunities near you"

---

### Screenshot 3: Bounty Creation
**File Location:** `app/tabs/postings-screen.tsx` → `CreateBountyFlow`

**Screen Description:**
- Multi-step bounty creation flow
- Clean form interface for entering task details
- Title, description, amount fields
- Work type selection (Online/In Person)
- Location picker for in-person tasks
- Deadline/time-sensitive toggle

**Capture State:**
- Show the form with partially filled data
- Example: "Help moving furniture" as title
- Amount showing "$50" or similar
- Work type selected as "In Person"
- Form should look inviting and easy to complete

**Marketing Text Suggestion:**
> "Post a task in minutes"

---

### Screenshot 4: Messaging/Inbox
**File Location:** `app/tabs/messenger-screen.tsx`

**Screen Description:**
- Conversation list showing active chats
- Each conversation shows avatar, name, last message, time
- Unread indicator badges
- Clean emerald theme
- Group chat capability shown

**Capture State:**
- 3-5 conversation threads visible
- Mix of individual and group conversations
- Some with unread badges
- Recent timestamps (e.g., "2h ago", "Yesterday")
- Sample last messages related to bounty coordination

**Marketing Text Suggestion:**
> "Coordinate directly with your helper"

---

### Screenshot 5: Profile Screen
**File Location:** `app/tabs/profile-screen.tsx`

**Screen Description:**
- User profile with avatar and username
- Stats showing: Jobs Accepted, Bounties Posted, Badges Earned
- Skillset chips with credentials
- Portfolio section
- Trust badges (Platform Security section)
- Achievements grid with unlocked badges

**Capture State:**
- Full profile visible with good stats
- 2-3 skill chips shown
- Some achievements unlocked
- Portfolio items if available
- Settings gear icon visible in header

**Marketing Text Suggestion:**
> "Build your reputation in the community"

---

### Screenshot 6: Wallet/Payments
**File Location:** `app/tabs/wallet-screen.tsx`

**Screen Description:**
- Balance card showing current wallet balance
- "Add Money" and "Withdraw" action buttons
- Linked accounts/payment methods section
- Transaction history with recent activity
- Shows escrow, release, deposit transactions

**Capture State:**
- Wallet balance showing a reasonable amount (e.g., "$125.00")
- At least one linked payment method visible
- 2-3 transaction history items showing:
  - Deposit transaction (green +)
  - Escrow transaction
  - Completed bounty payment

**Marketing Text Suggestion:**
> "Secure payments with escrow protection"

---

## Icon Verification

### Current App Icon Status

| File | Size | Status | Notes |
|------|------|--------|-------|
| `assets/images/bounty-icon.png` | 625 x 625 | ⚠️ **Needs Update** | Too small for App Store |
| `assets/images/icon.png` | 1024 x 1024 | ❌ **Placeholder** | Gray grid pattern, not final |

### App Store Icon Requirements

- **Size:** 1024 x 1024 pixels (required)
- **Format:** PNG
- **Color Space:** sRGB or P3
- **No Transparency:** Apple requires solid backgrounds (no alpha channel)
- **No Text:** Icons should not contain text (app name appears below)
- **No Rounded Corners:** Apple applies the mask automatically

### Action Items for Icon

| Priority | Task | Status |
|----------|------|--------|
| 🔴 High | Create 1024x1024 version of bounty-icon design | Pending |
| 🔴 High | Remove transparency - add solid background (recommend emerald #059669 or white) | Pending |
| 🟢 Done | Verify no text - current icon is a target/bullseye symbol | ✅ Compliant |
| 🔴 High | Replace `assets/images/icon.png` with final 1024x1024 icon | Pending |
| 🟡 Low | Update `app.json` if needed to reference correct icon path | If needed |

### Recommended Icon Design

The current bounty-icon.png shows a target/bullseye design which is:
- ✅ Recognizable and unique
- ✅ Works at small sizes
- ⚠️ May need color adjustment (white on emerald background recommended)
- ⚠️ Ensure no transparency for App Store compliance

---

## Screenshot Capture Workflow

### Recommended Tools
- **Xcode Simulator** for consistent captures
- **Expo Development Build** for testing on real devices
- **macOS Screenshot** (Cmd+Shift+4) for simulator captures

### Capture Steps

1. **Set up test data** with appealing sample bounties, conversations, and profile
2. **Launch app** in the appropriate simulator for each screen size
3. **Navigate to each screen** listed above
4. **Ensure good state** (data loaded, no loading spinners, no error states)
5. **Capture screenshot** at the exact dimensions required
6. **Apply marketing overlays** (optional but recommended)
7. **Export as PNG** at the correct resolution

### Simulator Device Mapping

| Screenshot Size | Simulator to Use |
|-----------------|------------------|
| 6.7" (1290 x 2796) | iPhone 15 Pro Max |
| 6.5" (1242 x 2688) | iPhone 11 Pro Max |
| 5.5" (1242 x 2208) | iPhone 8 Plus |
| iPad 12.9" (2048 x 2732) | iPad Pro 12.9" (6th gen) |

---

## Marketing Text Guidelines

When adding text overlays to screenshots:

- Keep text **brief and impactful** (5-7 words max)
- Use **consistent font** across all screenshots
- Position text at **top or bottom** to not obscure UI
- Use **contrasting colors** for readability
- Consider **localizing** text for different App Store regions

---

## File Delivery Checklist

- [ ] 6 screenshots at 1290 x 2796 (6.7" iPhone)
- [ ] 6 screenshots at 1242 x 2688 (6.5" iPhone)
- [ ] 6 screenshots at 1242 x 2208 (5.5" iPhone)
- [ ] 6 screenshots at 2048 x 2732 (iPad - optional)
- [ ] 1024 x 1024 app icon (PNG, no transparency)
- [ ] App preview video (optional, 15-30 seconds)
