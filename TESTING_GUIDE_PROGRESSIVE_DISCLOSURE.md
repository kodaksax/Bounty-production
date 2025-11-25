# Testing Guide: Progressive Disclosure Bounty Creation

## 🎯 Overview
This guide helps testers verify the refactored 3-step bounty creation flow.

## 📋 Prerequisites
- App running in development mode
- Access to Postings screen
- Test account logged in

## 🧪 Test Cases

### TC1: Happy Path - Paid Bounty with Location
**Steps:**
1. Navigate to Postings → New tab
2. Click "Create Bounty" or similar entry point
3. **Step 1**: Enter title "Need help moving furniture" (>5 chars)
4. **Step 1**: Enter description "I need help moving a couch and dining table..." (>20 chars)
5. Click "Next"
6. **Step 2**: Verify you're on "The Reward" step
7. **Step 2**: Select amount preset (e.g., $50) or enter custom amount
8. Click "Next"
9. **Step 3**: Verify you're on "Location (Optional)" step
10. **Step 3**: Select "In Person" work type
11. **Step 3**: Enter location "San Francisco, CA"
12. Click "Create Bounty"
13. Verify success message appears
14. Verify draft is cleared

**Expected Results:**
- ✅ All validations pass
- ✅ Button text changes to "Create Bounty" on step 3
- ✅ Loading state shown during submission
- ✅ Success alert appears
- ✅ Bounty is created in database

---

### TC2: Happy Path - Honor Bounty Online
**Steps:**
1. Navigate to Postings → New tab
2. Start bounty creation flow
3. **Step 1**: Enter valid title and description
4. Click "Next"
5. **Step 2**: Toggle "Post for Honor" ON
6. **Step 2**: Verify amount inputs are hidden
7. **Step 2**: Verify "Honor Bounty" info banner appears
8. Click "Next"
9. **Step 3**: Select "Online" work type
10. **Step 3**: Verify location input is hidden
11. **Step 3**: Verify "Remote Work" info banner appears
12. Click "Create Bounty"
13. Verify success message

**Expected Results:**
- ✅ Honor toggle works correctly
- ✅ Progressive disclosure hides/shows correct fields
- ✅ Online work doesn't require location
- ✅ Bounty created with isForHonor = true

---

### TC3: Validation - Empty Title
**Steps:**
1. Start bounty creation flow
2. **Step 1**: Leave title empty
3. **Step 1**: Enter valid description
4. Click "Next"

**Expected Results:**
- ❌ "Next" button is disabled or shows error
- ✅ Error message: "Title is required"
- ✅ Cannot proceed to step 2

---

### TC4: Validation - Short Description
**Steps:**
1. Start bounty creation flow
2. **Step 1**: Enter valid title
3. **Step 1**: Enter description "Too short" (< 20 chars)
4. Click "Next"

**Expected Results:**
- ❌ "Next" button is disabled or shows error
- ✅ Error message: "Description must be at least 20 characters"
- ✅ Character counter shows current length

---

### TC5: Validation - No Amount for Paid Bounty
**Steps:**
1. Complete step 1 successfully
2. **Step 2**: Ensure "Post for Honor" is OFF
3. **Step 2**: Don't select any amount (leave at $0)
4. Click "Next"

**Expected Results:**
- ❌ "Next" button is disabled
- ✅ Error may appear: "Amount must be at least $1"

---

### TC6: Validation - Location Required for In-Person
**Steps:**
1. Complete steps 1 and 2 successfully
2. **Step 3**: Select "In Person" work type
3. **Step 3**: Leave location empty
4. Click "Create Bounty"

**Expected Results:**
- ❌ Submission blocked or error shown
- ✅ Error message: "Location is required for in-person work"

---

### TC7: Navigation - Back Button Works
**Steps:**
1. Complete step 1, click "Next"
2. **Step 2**: Click "Back" button
3. Verify you're on step 1 again
4. Verify data is preserved (title, description)
5. Click "Next" to return to step 2
6. Click "Next" to go to step 3
7. **Step 3**: Click "Back" button
8. Verify you're on step 2 again

**Expected Results:**
- ✅ Back button navigates correctly
- ✅ Data is preserved when navigating back
- ✅ Step indicator updates correctly

---

### TC8: Draft Persistence
**Steps:**
1. Start bounty creation flow
2. **Step 1**: Enter valid title and description
3. Close the app or navigate away
4. Reopen the app and navigate to bounty creation
5. Verify draft is loaded

**Expected Results:**
- ✅ Draft is saved to AsyncStorage
- ✅ Draft loads on return
- ✅ All entered data is preserved

---

### TC9: Progressive Disclosure - Amount Fields
**Steps:**
1. Complete step 1
2. **Step 2**: Observe default state (honor OFF)
3. **Step 2**: Verify amount presets are visible
4. **Step 2**: Toggle "Post for Honor" ON
5. **Step 2**: Verify amount presets become hidden/grayed
6. **Step 2**: Verify honor info banner appears
7. **Step 2**: Toggle "Post for Honor" OFF
8. **Step 2**: Verify amount presets reappear

**Expected Results:**
- ✅ Fields show/hide based on toggle
- ✅ Info banners change appropriately
- ✅ Smooth transitions

---

### TC10: Progressive Disclosure - Location Field
**Steps:**
1. Complete steps 1 and 2
2. **Step 3**: Observe default state (usually "In Person")
3. **Step 3**: Verify location input is visible
4. **Step 3**: Select "Online" work type
5. **Step 3**: Verify location input disappears
6. **Step 3**: Verify "Remote Work" info banner appears
7. **Step 3**: Select "In Person" again
8. **Step 3**: Verify location input reappears

**Expected Results:**
- ✅ Location field shows/hides correctly
- ✅ Info banners change appropriately
- ✅ No layout shift issues

---

### TC11: Character Counters
**Steps:**
1. **Step 1**: Start typing in title field
2. Observe character counter updates in real-time
3. Type until near 120 character limit
4. Try to type beyond 120 characters
5. **Step 1**: Start typing in description field
6. Observe character counter updates

**Expected Results:**
- ✅ Counters update in real-time
- ✅ Title limited to 120 characters
- ✅ Counter shows "X/120 characters" format

---

### TC12: Loading States
**Steps:**
1. Complete all steps with valid data
2. Click "Create Bounty"
3. Observe button during submission

**Expected Results:**
- ✅ Button shows loading spinner
- ✅ Button text changes to "Creating..."
- ✅ Button is disabled during submission
- ✅ Cannot navigate back during submission

---

### TC13: Error Handling - Network Failure
**Steps:**
1. Turn off network connection
2. Complete all steps with valid data
3. Click "Create Bounty"

**Expected Results:**
- ✅ Error message appears (or offline queue message)
- ✅ Draft is preserved
- ✅ User can retry or exit

---

### TC14: Accessibility - Screen Reader
**Steps:**
1. Enable screen reader (VoiceOver/TalkBack)
2. Navigate through all 3 steps
3. Verify all labels are announced
4. Verify button states are announced

**Expected Results:**
- ✅ All inputs have proper labels
- ✅ Buttons announce their purpose
- ✅ Errors are announced
- ✅ Step progress is announced

---

### TC15: Keyboard Navigation
**Steps:**
1. Use keyboard to navigate (if web)
2. Tab through all fields in order
3. Verify focus indicators
4. Try to submit with Enter key

**Expected Results:**
- ✅ Tab order is logical
- ✅ Focus indicators visible
- ✅ Enter key triggers appropriate actions

---

## 🐛 Known Issues (If Any)

List any known issues here during testing:

1. **Issue**: [Description]
   - **Severity**: Low/Medium/High
   - **Workaround**: [Steps to work around]
   - **Fix Status**: Pending/In Progress/Fixed

---

## 📊 Test Results Template

| Test Case | Status | Notes | Tester | Date |
|-----------|--------|-------|--------|------|
| TC1 | ⬜ Pass / ❌ Fail | | | |
| TC2 | ⬜ Pass / ❌ Fail | | | |
| TC3 | ⬜ Pass / ❌ Fail | | | |
| TC4 | ⬜ Pass / ❌ Fail | | | |
| TC5 | ⬜ Pass / ❌ Fail | | | |
| TC6 | ⬜ Pass / ❌ Fail | | | |
| TC7 | ⬜ Pass / ❌ Fail | | | |
| TC8 | ⬜ Pass / ❌ Fail | | | |
| TC9 | ⬜ Pass / ❌ Fail | | | |
| TC10 | ⬜ Pass / ❌ Fail | | | |
| TC11 | ⬜ Pass / ❌ Fail | | | |
| TC12 | ⬜ Pass / ❌ Fail | | | |
| TC13 | ⬜ Pass / ❌ Fail | | | |
| TC14 | ⬜ Pass / ❌ Fail | | | |
| TC15 | ⬜ Pass / ❌ Fail | | | |

---

## 🔍 Edge Cases to Test

1. **Very long title** (exactly 120 characters)
2. **Very long description** (500+ characters)
3. **Special characters** in title/description
4. **Custom amount** with decimals (e.g., $50.99)
5. **Location with special characters** (e.g., "São Paulo, Brazil")
6. **Rapid clicking** of Next/Back buttons
7. **Network reconnection** during submission
8. **App backgrounding** during flow
9. **Memory pressure** scenarios
10. **Dark mode** compatibility (if supported)

---

## 📝 Regression Testing

Ensure these existing features still work:

- ✅ Previous bounties still load correctly
- ✅ Bounty listing/search still works
- ✅ Other bounty actions (edit, delete) unaffected
- ✅ Payment flow still works for completed bounties
- ✅ Messaging about bounties still works

---

## 🎯 Acceptance Criteria

This feature is ready for production when:

- [ ] All test cases pass
- [ ] No critical bugs found
- [ ] Performance is acceptable (< 2s submission time)
- [ ] Accessibility meets standards
- [ ] Works on iOS and Android
- [ ] Offline support verified
- [ ] Draft persistence verified
- [ ] Error handling verified
