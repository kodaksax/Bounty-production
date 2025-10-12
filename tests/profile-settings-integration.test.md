# Profile-Settings Integration Manual Test Guide

## Overview
This document provides step-by-step manual testing procedures to verify that profile updates from the Settings screen are immediately reflected in the Profile screen.

## Prerequisites
- BOUNTYExpo app running on device or simulator
- User account authenticated with Supabase
- Access to Profile and Settings screens

## Test Suite 1: Basic Profile Update Flow

### Test 1.1: Update Username from Settings
**Objective**: Verify username changes in Settings appear in Profile screen

**Steps:**
1. Navigate to Profile screen (bottom nav → profile icon)
2. Note current username displayed at top of profile
3. Tap Settings icon (gear icon in top right)
4. Tap "Edit Profile" card → "Save Changes" button
5. Update the "Name" field to a new username (e.g., "@testuser123")
6. Tap "Save" button in top right
7. Wait for success message "✓ Profile updated successfully!"
8. Tap back arrow to return to Settings
9. Tap back arrow to return to Profile screen

**Expected Results:**
- ✓ Success message appears after saving
- ✓ Profile screen automatically refreshes
- ✓ New username is displayed in Profile screen
- ✓ "Profile refreshed" notification appears briefly
- ✓ No manual refresh required

**Pass/Fail:** ___________

---

### Test 1.2: Update Bio/About from Settings
**Objective**: Verify bio updates in Settings appear in Profile screen

**Steps:**
1. Navigate to Profile screen
2. Note current bio/about text (or lack thereof)
3. Tap Settings → Edit Profile
4. Update the "Bio" field with new text (e.g., "Software developer passionate about bounties")
5. Tap Save
6. Return to Profile screen

**Expected Results:**
- ✓ New bio text appears in Profile screen
- ✓ Bio is correctly formatted and displayed
- ✓ Changes persist after navigation

**Pass/Fail:** ___________

---

### Test 1.3: Update Avatar from Settings
**Objective**: Verify avatar changes in Settings appear in Profile screen

**Steps:**
1. Navigate to Profile screen
2. Note current avatar image
3. Tap Settings → Edit Profile
4. Tap camera icon on avatar
5. Select a new image (if image picker works)
6. Wait for upload progress bar
7. Tap Save after upload completes
8. Return to Profile screen

**Expected Results:**
- ✓ Upload progress indicator shows during upload
- ✓ New avatar appears in Edit Profile screen
- ✓ New avatar appears in Profile screen after returning
- ✓ Avatar is properly sized and displayed

**Pass/Fail:** ___________

---

## Test Suite 2: Error Handling

### Test 2.1: Empty Name Validation
**Objective**: Verify validation prevents saving empty username

**Steps:**
1. Navigate to Settings → Edit Profile
2. Clear the "Name" field completely
3. Tap Save

**Expected Results:**
- ✓ Error message appears: "Name cannot be empty"
- ✓ Save operation is prevented
- ✓ User remains on Edit Profile screen
- ✓ Error message is dismissible

**Pass/Fail:** ___________

---

### Test 2.2: Invalid Avatar URL
**Objective**: Verify validation prevents invalid avatar URLs

**Steps:**
1. Navigate to Settings → Edit Profile
2. Manually set avatar to invalid URL (if possible via dev tools)
3. Tap Save

**Expected Results:**
- ✓ Error message appears: "Invalid avatar URL"
- ✓ Save operation is prevented
- ✓ User can correct the issue

**Pass/Fail:** ___________

---

### Test 2.3: Network Error Handling
**Objective**: Verify graceful handling of network errors

**Steps:**
1. Enable airplane mode or disable network
2. Navigate to Settings → Edit Profile
3. Update username
4. Tap Save

**Expected Results:**
- ✓ Error message appears indicating save failed
- ✓ User is notified to try again
- ✓ App doesn't crash
- ✓ Previous data is not lost

**Pass/Fail:** ___________

---

## Test Suite 3: Loading States

### Test 3.1: Loading Indicator on Save
**Objective**: Verify loading indicator appears during save

**Steps:**
1. Navigate to Settings → Edit Profile
2. Update any field
3. Tap Save
4. Observe the Save button

**Expected Results:**
- ✓ Save button shows loading spinner
- ✓ Save button is disabled during save
- ✓ User cannot tap Save again while saving
- ✓ Loading state clears after save completes

**Pass/Fail:** ___________

---

### Test 3.2: Loading Indicator on Profile Refresh
**Objective**: Verify loading state when returning from Settings

**Steps:**
1. Navigate to Settings → Edit Profile
2. Make and save changes
3. Observe notifications when returning to Profile screen

**Expected Results:**
- ✓ "Profile refreshed" message appears briefly
- ✓ No blocking loading spinner
- ✓ UI updates smoothly

**Pass/Fail:** ___________

---

### Test 3.3: Initial Load Error State
**Objective**: Verify error screen when profile fails to load

**Steps:**
1. Disconnect from network
2. Clear app cache (if possible)
3. Navigate to Settings → Edit Profile

**Expected Results:**
- ✓ Error screen appears with clear message
- ✓ "Go Back" button is available
- ✓ Error icon is displayed
- ✓ Error message explains the issue

**Pass/Fail:** ___________

---

## Test Suite 4: Data Persistence

### Test 4.1: Changes Persist Across Navigation
**Objective**: Verify profile changes persist when navigating away and back

**Steps:**
1. Update profile from Settings
2. Navigate to different tabs (Messenger, Wallet, etc.)
3. Return to Profile screen

**Expected Results:**
- ✓ Profile changes are still visible
- ✓ No data loss during navigation
- ✓ Profile doesn't revert to old values

**Pass/Fail:** ___________

---

### Test 4.2: Changes Persist After App Restart
**Objective**: Verify profile changes persist after closing and reopening app

**Steps:**
1. Update profile from Settings
2. Close the app completely
3. Reopen the app
4. Navigate to Profile screen

**Expected Results:**
- ✓ Profile changes are still visible after restart
- ✓ Data is loaded from Supabase
- ✓ No stale cached data shown

**Pass/Fail:** ___________

---

### Test 4.3: Multiple Field Updates
**Objective**: Verify multiple fields can be updated in one save

**Steps:**
1. Navigate to Settings → Edit Profile
2. Update username, bio, and avatar
3. Tap Save
4. Return to Profile screen

**Expected Results:**
- ✓ All changes are saved successfully
- ✓ All changes appear in Profile screen
- ✓ Single success notification shown

**Pass/Fail:** ___________

---

## Test Suite 5: Edge Cases

### Test 5.1: Rapid Navigation
**Objective**: Verify app handles rapid back-and-forth navigation

**Steps:**
1. Rapidly tap: Profile → Settings → Edit Profile → Back → Back
2. Repeat 3-4 times quickly

**Expected Results:**
- ✓ No crashes or hangs
- ✓ Navigation responds correctly
- ✓ Profile data loads correctly each time
- ✓ No memory leaks or performance issues

**Pass/Fail:** ___________

---

### Test 5.2: Cancel Without Saving
**Objective**: Verify unsaved changes don't affect profile

**Steps:**
1. Navigate to Settings → Edit Profile
2. Update username
3. Tap Back button WITHOUT saving
4. Return to Profile screen

**Expected Results:**
- ✓ Original username is still displayed
- ✓ No changes were applied
- ✓ Profile remains unchanged

**Pass/Fail:** ___________

---

### Test 5.3: Very Long Text Input
**Objective**: Verify app handles long text inputs

**Steps:**
1. Navigate to Settings → Edit Profile
2. Enter very long bio text (500+ characters)
3. Tap Save

**Expected Results:**
- ✓ Text is accepted and saved (or rejected with clear message)
- ✓ Bio displays correctly in Profile screen
- ✓ Text wraps or truncates appropriately
- ✓ No UI overflow issues

**Pass/Fail:** ___________

---

### Test 5.4: Special Characters in Username
**Objective**: Verify special characters are handled correctly

**Steps:**
1. Navigate to Settings → Edit Profile
2. Enter username with special characters (@, #, emojis)
3. Tap Save

**Expected Results:**
- ✓ Special characters are either accepted or rejected with clear error
- ✓ No crashes or encoding issues
- ✓ Display is correct in Profile screen

**Pass/Fail:** ___________

---

## Test Suite 6: Cross-Screen Consistency

### Test 6.1: Profile Appears Same in Multiple Locations
**Objective**: Verify profile shows consistently across app

**Steps:**
1. Update profile from Settings
2. Check Profile screen
3. Check Messenger screen (if profile shown there)
4. Check any other locations showing profile

**Expected Results:**
- ✓ Profile data is consistent everywhere
- ✓ All locations show updated data
- ✓ No discrepancies between screens

**Pass/Fail:** ___________

---

### Test 6.2: Settings Shows Current Profile
**Objective**: Verify Settings displays current profile data

**Steps:**
1. Update profile from app/profile/edit.tsx route (if accessible)
2. Navigate to Settings → Edit Profile

**Expected Results:**
- ✓ Edit Profile form shows current/updated values
- ✓ No stale data shown
- ✓ Form is pre-populated correctly

**Pass/Fail:** ___________

---

## Test Results Summary

**Total Tests:** 20
**Passed:** _____
**Failed:** _____
**Skipped:** _____

**Pass Rate:** _____%

## Critical Issues Found
(List any critical bugs or issues discovered during testing)

1. 
2. 
3. 

## Non-Critical Issues Found
(List minor issues or improvements needed)

1. 
2. 
3. 

## Recommendations

### High Priority
- [ ] Fix any critical issues blocking basic functionality
- [ ] Ensure data persistence works reliably
- [ ] Verify error messages are clear and actionable

### Medium Priority
- [ ] Improve loading states visual feedback
- [ ] Add validation for all input fields
- [ ] Test on different devices/screen sizes

### Low Priority
- [ ] Consider adding undo functionality
- [ ] Add confirmation dialog before discarding changes
- [ ] Implement real-time sync across devices

## Testing Environment
- **Date:** _____________
- **Tester:** _____________
- **Device/Simulator:** _____________
- **OS Version:** _____________
- **App Version:** _____________
- **Network Conditions:** _____________

## Sign-Off
- **Tester Signature:** _____________
- **Date:** _____________
- **Status:** [ ] Approved [ ] Needs Fixes [ ] Rejected

---

## Notes
Use this section to add any additional observations, screenshots, or context about the testing session.
