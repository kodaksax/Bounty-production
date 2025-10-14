# Location Features - Manual Test Plan

## Pre-Testing Setup
1. Ensure expo-location is installed: `npm list expo-location`
2. Start the app: `npx expo start`
3. Use a device/simulator with location services

## Test Suite

### Test 1: Location Tab Access
**Steps:**
1. Launch the app
2. Look at bottom navigation bar
3. Locate and tap the "place" (location pin) icon

**Expected:**
- Location tab icon is visible in bottom nav
- Tapping navigates to "Location & Visibility" screen
- Screen shows two sections: Location Permissions and Saved Addresses

**Pass/Fail:** ___

---

### Test 2: Location Permission Request (First Time)
**Steps:**
1. Navigate to Location & Visibility tab
2. Observe permission status
3. Tap "Grant Permission" button
4. Respond to system permission dialog

**Expected:**
- Status shows "Denied" or "Undetermined" initially
- System permission dialog appears
- If granted: Shows "Granted" status and displays coordinates
- If denied: Shows appropriate message

**Pass/Fail:** ___

---

### Test 3: Add Saved Address
**Steps:**
1. In Location & Visibility tab, tap "Add" button
2. Enter label: "Home"
3. Enter address: "123 Main St, San Francisco, CA 94105"
4. Tap "Save"

**Expected:**
- Form appears with two input fields
- After saving, address appears in list below
- Form clears and closes
- Address shows label "Home" and full address

**Pass/Fail:** ___

---

### Test 4: Edit Saved Address
**Steps:**
1. Tap edit icon (pencil) on a saved address
2. Change label to "My Home"
3. Tap "Update"

**Expected:**
- Form pre-populates with existing data
- Changes persist after update
- Address list updates immediately

**Pass/Fail:** ___

---

### Test 5: Delete Saved Address
**Steps:**
1. Tap delete icon (trash) on a saved address
2. Observe confirmation dialog
3. Tap "Delete"

**Expected:**
- Confirmation dialog appears with address name
- After confirmation, address removed from list
- If it was the last address, empty state appears

**Pass/Fail:** ___

---

### Test 6: Address Autocomplete in Bounty Creation
**Steps:**
1. Add at least 2 saved addresses (if not already done)
2. Navigate to Create/Postings tab
3. Start creating a new bounty
4. Select "In Person" work type
5. In location field, type first 2 letters of a saved address label

**Expected:**
- Suggestions dropdown appears after 2 characters
- Shows matching saved addresses
- Each suggestion shows label and full address
- Tapping a suggestion populates the location field

**Pass/Fail:** ___

---

### Test 7: Distance Filter Visibility
**Steps:**
1. Navigate to main bounty dashboard (home screen)
2. Scroll to filter section
3. Look for distance filter chips below category chips

**Expected:**
- If location permission granted: Distance filter visible with options (5mi, 10mi, 25mi, 50mi)
- If location permission denied: Distance filter not visible
- Filter shows location icon and "Distance:" label

**Pass/Fail:** ___

---

### Test 8: Filter Bounties by Distance
**Prerequisites:** Location permission must be granted

**Steps:**
1. On bounty dashboard, tap "10mi" distance filter
2. Observe bounty list
3. Tap "10mi" again or tap "X" button

**Expected:**
- Active filter chip highlights (different color)
- Only bounties within 10 miles shown (online/remote always shown)
- Tap again or "X" clears filter
- All bounties reappear when filter cleared

**Pass/Fail:** ___

---

### Test 9: Distance Display on Bounties
**Steps:**
1. View bounty list on dashboard
2. Observe distance shown on each bounty card
3. Note if distances make sense relative to each other

**Expected:**
- Each bounty shows distance in format "X mi away"
- With location permission: Real calculated distances
- Without location permission: Consistent mock distances
- Bounties sorted by proximity (closest first)

**Pass/Fail:** ___

---

### Test 10: Distance in Bounty Detail Modal
**Steps:**
1. Tap on any bounty in the list
2. Observe detail modal
3. Look for distance information

**Expected:**
- Modal shows "X mi away" below the price
- Distance matches what was shown in list
- Modal displays properly on all screen sizes

**Pass/Fail:** ___

---

### Test 11: Empty State - No Addresses
**Steps:**
1. Delete all saved addresses
2. Observe the Saved Addresses section

**Expected:**
- Empty state shows location pin icon
- Text: "No addresses saved yet"
- Helpful description about adding addresses
- "Add" button remains visible and functional

**Pass/Fail:** ___

---

### Test 12: Permission Denied Recovery
**Steps:**
1. Deny location permission (in system settings if needed)
2. Navigate to Location & Visibility tab
3. Observe status
4. Re-enable permission in system settings
5. Return to app

**Expected:**
- Status shows "Denied"
- Helpful message about enabling in Settings
- Distance filters hidden on dashboard
- App remains functional with mock distances
- After re-enabling, features work again

**Pass/Fail:** ___

---

### Test 13: Multi-Address Search
**Steps:**
1. Add 5+ addresses with different labels
2. In bounty creation location field, type partial text
3. Try typing part of label, then part of address

**Expected:**
- Autocomplete searches both label and address text
- Only matching addresses shown
- Case-insensitive search
- Real-time filtering as you type

**Pass/Fail:** ___

---

### Test 14: UI/UX Validation
**Steps:**
1. Navigate through all location features
2. Test on different screen sizes if possible
3. Verify bottom navigation doesn't cover content

**Expected:**
- All screens have proper padding for bottom nav
- Safe areas respected (iOS notch, Android status bar)
- Emerald theme consistent throughout
- Text readable on all backgrounds
- Touch targets adequate size
- No UI overlap or clipping

**Pass/Fail:** ___

---

### Test 15: Performance Check
**Steps:**
1. Add 10+ saved addresses
2. Navigate to Location & Visibility tab
3. Scroll through address list
4. Use autocomplete with many addresses
5. Apply/clear distance filters multiple times

**Expected:**
- No lag when rendering address list
- Smooth scrolling
- Instant autocomplete response
- Quick filter application
- No memory issues or crashes

**Pass/Fail:** ___

---

## Edge Case Tests

### Edge 1: Very Long Address
**Steps:** Add address with 200+ characters

**Expected:** Should truncate or wrap properly, no UI break

**Pass/Fail:** ___

---

### Edge 2: Special Characters in Label
**Steps:** Add address with emoji and special chars: "🏠 Home (Main) #1"

**Expected:** Should save and display correctly

**Pass/Fail:** ___

---

### Edge 3: Location Permission Mid-Session
**Steps:** Revoke location permission while app is running

**Expected:** App handles gracefully, distance features hide

**Pass/Fail:** ___

---

### Edge 4: No GPS Signal
**Steps:** Use in area with poor GPS (or airplane mode)

**Expected:** Shows error message, app remains functional

**Pass/Fail:** ___

---

## Regression Tests

### Regression 1: Bottom Navigation Still Works
**Steps:** Navigate to all tabs (wallet, postings, profile, etc.)

**Expected:** All tabs accessible, location tab doesn't break navigation

**Pass/Fail:** ___

---

### Regression 2: Bounty Creation Flow
**Steps:** Create a complete bounty (all steps)

**Expected:** Location step works seamlessly in flow

**Pass/Fail:** ___

---

### Regression 3: Bounty List Performance
**Steps:** Load many bounties, scroll through list

**Expected:** No performance degradation from distance calculations

**Pass/Fail:** ___

---

## Summary

**Total Tests:** 15 + 4 edge cases + 3 regression = 22 tests

**Passed:** ___
**Failed:** ___
**Not Tested:** ___

## Critical Issues Found
(List any blocking issues discovered during testing)

1. 
2. 
3. 

## Minor Issues Found
(List any non-blocking issues or improvements)

1. 
2. 
3. 

## Notes
(Any additional observations or comments)

---

## Sign-off

**Tester Name:** ___________________________

**Date:** ___________________________

**Build/Version:** ___________________________

**Device/Simulator:** ___________________________
