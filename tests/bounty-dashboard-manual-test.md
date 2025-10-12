# Bounty Dashboard Manual Testing Guide

This guide provides step-by-step instructions for manually testing the bounty dashboard flow.

## Prerequisites

- App running via `npx expo start`
- User authenticated with test account
- At least one bounty posted by the authenticated user

## Test Scenarios

### 1. Navigation to Dashboard

**Steps:**
1. Open the app
2. Navigate to "Postings" tab via bottom navigation
3. Switch to "My Postings" tab
4. Tap on any bounty card you own

**Expected:**
- Bounty Dashboard screen opens
- Header shows "Bounty Dashboard" with back button
- Bounty card displays: avatar, title, age, status badge, and amount (or "For Honor")

### 2. Timeline Component

**Steps:**
1. On the Dashboard, observe the "Progress Timeline" section
2. Note the current active stage (highlighted with emerald background)
3. Try tapping on previous stages (stages before the current one)
4. Try tapping on future stages (stages after the current one)

**Expected:**
- Timeline shows 4 stages: Apply & Work, Working Progress, Review & Verify, Payout
- Current stage is highlighted with emerald border and filled icon
- Previous stages are accessible (tappable) and show completion checkmark
- Future stages are locked (slightly faded, not tappable)
- Alert shows when tapping locked stages: "Stage Locked"

### 3. Quick Message

**Steps:**
1. Scroll to "Quick Message" section
2. If conversation exists:
   - Type a test message in the input field
   - Tap the send button
3. If no conversation exists, observe the placeholder

**Expected:**
- With conversation: Message input is functional, send button becomes active when text is entered
- Success alert shows "Message sent successfully!"
- Without conversation: Shows icon, "No active conversation yet" message, and explanation

### 4. Context Panel - Description

**Steps:**
1. Scroll to "Description" section
2. If description is longer than 150 characters:
   - Observe the preview with "..." truncation
   - Tap "Show More" button
   - Tap "Show Less" button
3. Observe additional info (location, timeline, skills if present)

**Expected:**
- Long descriptions are truncated with "..." and "Show More" button
- Tapping "Show More" expands the full description
- Tapping "Show Less" collapses back to preview
- Location, timeline, and skills display correctly with icons

### 5. Next Button - Navigation to Review & Verify

**Steps:**
1. At bottom of Dashboard, tap "Next Stage" or "Go to Review & Verify" button
2. Observe the Review & Verify screen

**Expected:**
- Navigation to Review & Verify screen
- Header shows "Review & Verify" with back button
- Bounty info card displays at top

### 6. Review & Verify - Proof Section

**Steps:**
1. On Review & Verify screen, observe "Submitted Proof" section
2. If proof items exist, tap the view icon on any item
3. If no proof items, observe the empty state

**Expected:**
- Proof items display with appropriate icons (image/file), name, and size
- View button is present for each item
- Empty state shows folder icon and "No proof submitted yet" message

### 7. Review & Verify - Rating

**Steps:**
1. Scroll to "Rate the Work" section
2. Tap each star from 1 to 5
3. Observe the rating label change
4. Type a comment in the optional comment field
5. Try tapping "Proceed to Payout" without rating
6. Select a rating and tap "Proceed to Payout"

**Expected:**
- Stars fill/unfill as tapped
- Rating label shows: Poor (1), Fair (2), Good (3), Very Good (4), Excellent (5)
- Comment input accepts text
- Alert shows "Rating Required" when proceeding without rating
- Navigation to Payout screen when rating is provided

### 8. Payout - Honor Bounty

**Setup:** Use a bounty marked as "For Honor"

**Steps:**
1. Navigate to Payout screen
2. Observe the payout card
3. Tap "Mark as Complete" button
4. Confirm in the alert dialog

**Expected:**
- Payout card shows heart icon with "For Honor" label
- No payout amount displayed
- "Release Payout" button is not shown
- "Mark as Complete" button is available
- Alert confirms the action
- Success message shows and navigates back to bounty feed

### 9. Payout - Paid Bounty

**Setup:** Use a bounty with a dollar amount

**Steps:**
1. Navigate to Payout screen
2. Observe the payout amount and current balance
3. Try tapping "Release Payout" without confirmation toggle
4. Toggle the "I confirm payout release" switch
5. Tap "Release Payout" button
6. Observe the success message

**Expected:**
- Payout amount displays prominently ($X.XX)
- Current balance is shown
- "Release Payout" button is disabled without confirmation
- Toggle switch enables the button
- Success alert shows after release
- Wallet is updated with transaction
- Navigation back to bounty feed
- Bounty status changes to "completed"

### 10. Payout - Already Completed

**Setup:** Use a bounty already marked as completed

**Steps:**
1. Navigate to Payout screen
2. Observe the UI

**Expected:**
- Completed card displays with checkmark icon
- "Bounty Completed" message shown
- "This bounty has already been completed and archived" subtext
- Action buttons are not shown

### 11. Ownership Guards

**Setup:** Attempt to access another user's bounty dashboard (via direct URL manipulation if possible)

**Expected:**
- Access denied alert shows
- "You can only view your own bounty dashboards" message
- Automatically navigates back

### 12. Error Handling

**Steps:**
1. Attempt to load a non-existent bounty (invalid ID)
2. Simulate network failure (airplane mode)
3. Observe error states

**Expected:**
- Error icon and message displayed
- "Retry" button available
- "Go Back" button available
- Error message is descriptive

### 13. Safe Area & Bottom Padding

**Steps:**
1. Scroll through each screen (Dashboard, Review & Verify, Payout)
2. Ensure content is fully scrollable and not hidden behind navigation

**Expected:**
- Bottom padding ensures no content is hidden behind BottomNav
- Safe area insets respected on iOS devices
- All content is accessible via scroll

## Success Criteria

✅ All navigation flows work correctly
✅ Timeline reflects bounty status accurately
✅ Ownership guards prevent unauthorized access
✅ Messaging integration functions
✅ Rating system validates input
✅ Payout handles both honor and paid bounties
✅ Error states display appropriately
✅ UI respects safe areas and bottom navigation
✅ Wallet transactions are logged correctly

## Notes

- The proof items in Review & Verify are currently mock data
- Real proof attachment upload would be implemented in a future iteration
- Message service uses mock conversations for demonstration
- Wallet transactions are persisted in AsyncStorage
