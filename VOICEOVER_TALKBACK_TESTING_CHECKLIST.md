# VoiceOver/TalkBack Testing Checklist

This checklist provides a structured approach to manually testing accessibility features using screen readers on iOS (VoiceOver) and Android (TalkBack).

## Pre-Testing Setup

### iOS VoiceOver Setup
- [ ] Open Settings → Accessibility → VoiceOver
- [ ] Turn on VoiceOver
- [ ] Optional: Enable VoiceOver shortcut (triple-click side button)
- [ ] Learn basic gestures:
  - Single finger swipe right/left: Navigate between elements
  - Double-tap: Activate element
  - Two-finger double-tap: Start/stop action
  - Three-finger swipe: Scroll pages

### Android TalkBack Setup
- [ ] Open Settings → Accessibility → TalkBack
- [ ] Turn on TalkBack
- [ ] Optional: Enable TalkBack shortcut (volume keys)
- [ ] Learn basic gestures:
  - Single finger swipe right/left: Navigate between elements
  - Double-tap: Activate element
  - Two-finger swipe: Scroll
  - Up then down (L shape): Read from top

## Core Navigation Testing

### Bottom Navigation Bar
- [ ] Navigate to bottom navigation
- [ ] Verify each nav item announces:
  - [ ] "Create" - "Create new bounty or message, button"
  - [ ] "Wallet" - Clear wallet/money description, button
  - [ ] "Bounty" (center) - "Main screen" or "Bounty dashboard", button, selected
  - [ ] "Postings" - "View postings", button
  - [ ] "Profile" - "View profile", button
- [ ] Verify selection state is announced ("selected" or "not selected")
- [ ] Test navigation:
  - [ ] Tap each button and verify screen changes
  - [ ] Confirm selection state updates correctly
- [ ] Verify haptic feedback on tap

### Screen Headers
- [ ] Each screen should have a header with:
  - [ ] Screen title announced as "header"
  - [ ] Action buttons with clear labels
  - [ ] Search buttons announce "Search" with hint

## Dashboard/Bounty Screen Testing

### Header Elements
- [ ] Balance button announces "Account balance: $X.XX"
- [ ] Balance button hint: "View wallet and manage funds"
- [ ] Search button announces "Open search"
- [ ] Logo/GPS icon is hidden from screen reader (decorative)

### Filter Chips
- [ ] Each filter chip announces:
  - [ ] Label (e.g., "Filter by Recent")
  - [ ] Selection state ("currently active" or not)
  - [ ] Action hint ("Tap to remove filter" or "Tap to filter...")
  - [ ] Role: "button"
- [ ] Distance filter announces current distance
- [ ] Category filters announce category name

### Bounty List Items
For each bounty card, verify announcement includes:
- [ ] Bounty title
- [ ] Poster username
- [ ] Price ($XX.XX) or "for honor"
- [ ] Location/distance if available
- [ ] Age badge (e.g., "Posted 2 hours ago")
- [ ] Role: "button"
- [ ] Hint: "Opens bounty details"

### Empty States
- [ ] Empty state container is accessible
- [ ] Title announced as "header"
- [ ] Description text is read
- [ ] Action button has clear label and hint
- [ ] Icon is hidden from screen reader

## Wallet Screen Testing

### Header
- [ ] Screen title "Wallet" announced as header
- [ ] Add Money button: "Add money to wallet, button"
- [ ] Withdraw button: "Withdraw funds, button"

### Balance Display
- [ ] Current balance is announced
- [ ] Available/pending amounts are clear

### Payment Methods
- [ ] Each payment method card is accessible
- [ ] Card type, last 4 digits announced
- [ ] Edit/remove buttons have clear labels

### Transaction History
- [ ] Each transaction is accessible
- [ ] Amount, type, date announced
- [ ] Status is clear (completed, pending, etc.)

## Postings Screen Testing

### Tabs
- [ ] "My Postings" tab announces:
  - [ ] "My Postings, tab, 1 of 2"
  - [ ] Selection state
  - [ ] Role: "tab"
- [ ] "Work in Progress" tab announces:
  - [ ] "Work in Progress, tab, 2 of 2"
  - [ ] Selection state
  - [ ] Role: "tab"

### Filters
- [ ] "All" filter: "Filter by All postings, button"
- [ ] "Online" filter: "Filter by Online postings, button"
- [ ] "In Person" filter: "Filter by In Person postings, button"
- [ ] Selection state announced

### Posting Items
- [ ] Each posting announces key information
- [ ] Status is clear (open, in progress, completed)
- [ ] Action buttons have descriptive labels

## Search Screen Testing

### Search Input
- [ ] Input announces "Search bounties, search field"
- [ ] Hint mentions autocomplete/suggestions
- [ ] Keyboard dismissal is accessible

### Tabs
- [ ] "Search bounties" tab with selection state
- [ ] "Search users" tab with selection state
- [ ] Tab index announced (1 of 2, 2 of 2)

### Results
For bounty results:
- [ ] Title, price/honor, location announced
- [ ] Verification status if applicable
- [ ] Skills/tags mentioned
- [ ] Role: "button"
- [ ] Hint: "Opens bounty details"

For user results:
- [ ] Username announced
- [ ] Verification status
- [ ] Skills listed
- [ ] Role: "button"
- [ ] Hint: "View user profile"

### Recent Searches
- [ ] Each recent search announces query
- [ ] Remove button: "Remove recent search, button"

## Profile Screen Testing

### Header Actions
- [ ] Share button: "Share profile, button"
- [ ] Share hint: about social sharing
- [ ] Settings button: "Open settings, button"
- [ ] Settings hint: "Access profile settings and preferences"

### Profile Information
- [ ] Username/name is accessible
- [ ] Bio text is readable
- [ ] Stats (bounties posted, completed) are clear
- [ ] Avatar image has appropriate label or is decorative

### Edit Profile
- [ ] Edit button has clear label
- [ ] Form fields have labels and hints
- [ ] Validation errors are announced

## Messenger/Chat Screen Testing

### Conversation List
- [ ] Each conversation card announces:
  - [ ] Contact name/group name
  - [ ] Last message preview
  - [ ] Timestamp
  - [ ] Unread indicator if applicable

### Chat Detail
- [ ] Message input field is labeled
- [ ] Send button has clear label
- [ ] Attachment button has clear purpose
- [ ] Messages are readable with sender and time

### Message Actions
When long-pressing a message:
- [ ] Action sheet announces "Message actions, menu"
- [ ] Pin/Unpin reflects current state
- [ ] Copy: "Copy message text, button"
- [ ] Report: Clear reporting purpose
- [ ] Block: Warning about action
- [ ] Cancel overlay is accessible

## Verification Screen Testing

### Document Type Selection
- [ ] Each option announces:
  - [ ] Document type (Driver's License, Passport, etc.)
  - [ ] Role: "radio"
  - [ ] Selection state
  - [ ] Position (1 of 3, 2 of 3, 3 of 3)
  - [ ] Hint: "Select this document type for verification"

### Photo Upload
- [ ] "Upload front side" button with clear context
- [ ] "Upload back side" button (if applicable)
- [ ] Hint mentions camera/library options
- [ ] Upload status announced

### Submit Button
- [ ] Submit button label clear
- [ ] Disabled state announced when incomplete
- [ ] Hint mentions review time

## Hunter Application Flow

### Progress Timeline
- [ ] Each stage announces:
  - [ ] Stage number and total (1 of 4, 2 of 4, etc.)
  - [ ] Stage label (Apply, Work in Progress, etc.)
  - [ ] Status (current, completed, locked)
- [ ] Visual indicators are supplemented with audio

### Application Form
- [ ] All form fields have labels
- [ ] Validation errors are announced
- [ ] Submit button state is clear

## Forms and Inputs Testing

### General Form Accessibility
- [ ] All inputs have descriptive labels
- [ ] Required fields indicated
- [ ] Validation errors announced immediately
- [ ] Helper text/hints provided
- [ ] Success messages announced

### Date/Time Pickers
- [ ] Picker announces current selection
- [ ] Instructions for changing values
- [ ] Confirmation button labeled

### Switches/Toggles
- [ ] Current state announced (on/off, enabled/disabled)
- [ ] Label describes what toggle controls
- [ ] Role: "switch"

## Modals and Overlays

### General Modal Testing
- [ ] Modal content is accessible when opened
- [ ] Focus moves into modal
- [ ] Close button clearly labeled
- [ ] Modal title announced as header
- [ ] Background overlay is properly handled

### Confirmation Dialogs
- [ ] Message is clear
- [ ] Action buttons (Confirm/Cancel) well-labeled
- [ ] Destructive actions clearly marked

## Error States and Feedback

### Error Messages
- [ ] Error messages are announced
- [ ] Error context is clear
- [ ] Recovery actions suggested
- [ ] Retry buttons accessible

### Loading States
- [ ] Loading indicators announced
- [ ] Progress updates if applicable
- [ ] User can identify what's loading

### Success Feedback
- [ ] Success messages announced
- [ ] Confirmation is clear
- [ ] Next steps indicated

## Complex Interactions

### Swipe Gestures
- [ ] Alternative interactions available
- [ ] Actions accessible via buttons
- [ ] Instructions provided if needed

### Maps and Location
- [ ] Location information announced
- [ ] Alternative text descriptions provided
- [ ] Controls are accessible

### Charts and Graphs
- [ ] Data is available in text format
- [ ] Key insights announced
- [ ] Alternative data views available

## Edge Cases and Special Scenarios

### Empty States
- [ ] Empty state message is clear
- [ ] Call-to-action button accessible
- [ ] Icon is decorative (hidden)

### Network Errors
- [ ] Error message announced
- [ ] Retry button accessible
- [ ] Offline indicator clear

### Permissions
- [ ] Permission requests explained
- [ ] Allow/deny buttons clear
- [ ] Rationale for permission provided

## Testing Checklist Summary

### Quick Pass Criteria
- [ ] All interactive elements are reachable via swipe navigation
- [ ] All buttons have descriptive labels
- [ ] All decorative images are hidden from screen reader
- [ ] Selection states are announced
- [ ] Form fields have labels and validation feedback
- [ ] Modals and overlays are accessible
- [ ] Error messages are announced
- [ ] Navigation flow is logical
- [ ] No redundant announcements
- [ ] No "unlabeled button" or "button" without context

### Common Issues to Watch For
- ❌ "Button" with no descriptive label
- ❌ Icons that are not hidden from screen reader
- ❌ Missing selection state on tabs/filters
- ❌ Form inputs without labels
- ❌ Error messages not announced
- ❌ Touch targets too small or overlapping
- ❌ Illogical navigation order
- ❌ Modals that trap focus

### Documentation
After testing, document:
- [ ] Issues found with severity (critical, major, minor)
- [ ] Steps to reproduce issues
- [ ] Suggested fixes
- [ ] Screenshots/recordings if helpful
- [ ] Test device and OS version
- [ ] Screen reader version

## Post-Testing

### Report Template
```
## Test Session Information
- Date: [Date]
- Platform: [iOS/Android]
- OS Version: [Version]
- Screen Reader: [VoiceOver/TalkBack version]
- Device: [Device model]
- Tester: [Name]

## Summary
- Total Screens Tested: [Number]
- Critical Issues: [Number]
- Major Issues: [Number]
- Minor Issues: [Number]

## Critical Issues
[List issues that prevent users from completing core tasks]

## Major Issues
[List issues that significantly impact usability]

## Minor Issues
[List issues that are inconvenient but don't block functionality]

## Positive Findings
[List what works well]

## Recommendations
[Prioritized list of improvements]
```

### Follow-Up Actions
- [ ] File issues for critical problems
- [ ] Schedule fixes with development team
- [ ] Re-test after fixes implemented
- [ ] Update documentation
- [ ] Share findings with team

## Resources

- [iOS VoiceOver Guide](https://support.apple.com/guide/iphone/turn-on-and-practice-voiceover-iph3e2e415f/ios)
- [Android TalkBack Guide](https://support.google.com/accessibility/android/answer/6283677)
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [React Native Accessibility Docs](https://reactnative.dev/docs/accessibility)
- Internal: `ACCESSIBILITY_GUIDE.md`
- Internal: `ACCESSIBILITY_TESTING_GUIDE.md`
