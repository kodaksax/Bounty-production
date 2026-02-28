# Onboarding Carousel Testing Plan

## Objective
Verify that the enhanced onboarding carousel works correctly for both new and returning users.

## Test Environment Setup

### Prerequisites
1. Expo development environment running
2. iOS Simulator or Android Emulator
3. Clean app installation (no cached data)
4. Access to Supabase profiles table

### Test Users
- **New User**: User who has never logged in before
- **Returning User**: User who has completed onboarding previously
- **Skip User**: User who skipped the carousel

## Test Cases

### TC-001: New User - First Login (Complete Tour)
**Objective**: Verify carousel shows for new users and full onboarding works

**Steps**:
1. Launch app
2. Sign up with new account
3. Observe onboarding flow starts
4. Verify carousel appears with Slide 1
5. Tap "Next" button
6. Verify Slide 2 appears with "STEP 1" badge
7. Continue tapping "Next" through all 7 slides
8. Verify "Get Started" button appears on Slide 7
9. Tap "Get Started"
10. Complete username, details, phone verification
11. Complete full onboarding flow
12. Verify app opens to main dashboard

**Expected Results**:
- ✅ Carousel shows automatically
- ✅ All 7 slides display correctly
- ✅ Step badges (STEP 1-4) appear on slides 2-5
- ✅ Navigation works smoothly
- ✅ "Get Started" proceeds to username setup
- ✅ `onboarding_completed` set to `true` in database
- ✅ App opens to main dashboard after completion

### TC-002: New User - Skip with Confirmation
**Objective**: Verify skip functionality and confirmation modal

**Steps**:
1. Launch app
2. Sign up with new account
3. Carousel appears
4. Tap "Skip" button (top right)
5. Verify modal appears with:
   - Info icon
   - "Skip Tutorial?" title
   - Description text
   - "Continue Tour" button
   - "Skip" button
6. Tap "Continue Tour"
7. Verify modal dismisses
8. Verify still on same carousel slide
9. Tap "Skip" again
10. Tap "Skip" in modal
11. Verify proceeds to username setup

**Expected Results**:
- ✅ Skip button visible and tappable
- ✅ Modal shows with correct content
- ✅ "Continue Tour" dismisses modal without skipping
- ✅ "Skip" in modal proceeds to username setup
- ✅ Carousel state saved in AsyncStorage
- ✅ Rest of onboarding completes normally

### TC-003: Returning User - No Carousel
**Objective**: Verify carousel doesn't show for users who completed onboarding

**Steps**:
1. Use account that completed onboarding in TC-001
2. Log out
3. Log back in
4. Observe app behavior

**Expected Results**:
- ✅ Carousel does NOT appear
- ✅ App navigates directly to main dashboard
- ✅ No onboarding screens shown
- ✅ User can access all features immediately

### TC-004: Returning User - Previously Skipped
**Objective**: Verify behavior for users who skipped carousel

**Steps**:
1. Use account that skipped carousel in TC-002
2. Log out
3. Log back in
4. Observe app behavior

**Expected Results**:
- ✅ Carousel does NOT appear again
- ✅ App navigates directly to main dashboard
- ✅ AsyncStorage flag prevents carousel re-show

### TC-005: Visual Validation - All Slides
**Objective**: Verify visual appearance of each slide

**Steps**:
1. Start carousel as new user
2. Take screenshot of each slide
3. Verify for each slide:
   - Logo appears at top
   - Skip button in top right
   - Icon displays correctly
   - Title is readable
   - Description text is clear
   - Dots indicator shows correct position
   - Next/Get Started button at bottom

**Slides to Check**:
- Slide 1: Welcome (📍 icon, no badge)
- Slide 2: Step 1 (➕ icon, STEP 1 badge)
- Slide 3: Step 2 (👥 icon, STEP 2 badge)
- Slide 4: Step 3 (💬 icon, STEP 3 badge)
- Slide 5: Step 4 (✓ icon, STEP 4 badge)
- Slide 6: Browse & Earn (💵 icon, no badge)
- Slide 7: Safe & Secure (🔒 icon, no badge)

**Expected Results**:
- ✅ All visual elements render correctly
- ✅ Step badges only on slides 2-5
- ✅ Colors match emerald theme
- ✅ Text is readable on all screens
- ✅ Icons are appropriate size and color

### TC-006: Interaction - Swipe Navigation
**Objective**: Verify carousel can be navigated by swiping

**Steps**:
1. Start carousel
2. Swipe left to advance to next slide
3. Swipe right to go back to previous slide
4. Verify dots indicator updates
5. Verify animations play smoothly

**Expected Results**:
- ✅ Swipe left advances to next slide
- ✅ Swipe right goes to previous slide
- ✅ Dots indicator animates correctly
- ✅ Fade/scale animations smooth
- ✅ No lag or stuttering

### TC-007: Modal - Android Back Button
**Objective**: Verify modal dismissal on Android

**Steps**:
1. Start carousel on Android device/emulator
2. Tap "Skip" button
3. Modal appears
4. Press Android back button
5. Verify modal behavior

**Expected Results**:
- ✅ Android back button dismisses modal
- ✅ Returns to carousel (doesn't exit app)
- ✅ Carousel remains on same slide

### TC-008: Database Verification
**Objective**: Verify database field is set correctly

**Steps**:
1. Create new user
2. Complete full onboarding flow
3. Query Supabase profiles table:
   ```sql
   SELECT id, username, onboarding_completed
   FROM profiles
   WHERE id = '<user_id>';
   ```

**Expected Results**:
- ✅ `onboarding_completed` field exists
- ✅ Value is `true` after completion
- ✅ Value is `false` for new users before completion

### TC-009: Edge Case - Network Failure
**Objective**: Verify app handles network issues gracefully

**Steps**:
1. Start carousel
2. Disable network connectivity
3. Complete carousel
4. Attempt to proceed to username setup
5. Verify error handling

**Expected Results**:
- ✅ Carousel still navigates offline
- ✅ Error shown when trying to proceed without network
- ✅ User can retry once network restored
- ✅ No data loss

### TC-010: Edge Case - App Backgrounding
**Objective**: Verify carousel state persists through app lifecycle

**Steps**:
1. Start carousel
2. Navigate to slide 3
3. Background the app
4. Wait 30 seconds
5. Foreground the app
6. Check current slide

**Expected Results**:
- ✅ Carousel resumes at same slide
- ✅ No state loss
- ✅ Can continue normally

## Performance Tests

### PT-001: Load Time
**Objective**: Carousel loads quickly
- Target: < 1 second to first slide
- Test: Measure time from onboarding route to carousel visible

### PT-002: Animation Performance
**Objective**: Animations are smooth
- Target: 60 FPS
- Test: Monitor frame rate during slide transitions

### PT-003: Memory Usage
**Objective**: No memory leaks
- Target: Stable memory usage
- Test: Monitor memory through multiple carousel runs

## Accessibility Tests

### AT-001: Screen Reader
**Objective**: Carousel works with screen readers
- Test: Enable VoiceOver (iOS) or TalkBack (Android)
- Verify all text is announced
- Verify buttons are labeled correctly

### AT-002: Text Scaling
**Objective**: Text remains readable when scaled
- Test: Increase system text size to maximum
- Verify text doesn't overflow or clip

### AT-003: Color Blindness
**Objective**: Content is distinguishable without color
- Test: Use color blindness simulator
- Verify step numbers/icons provide enough context

## Browser/Device Matrix

### iOS Devices
- [ ] iPhone SE (small screen)
- [ ] iPhone 14 (standard)
- [ ] iPhone 14 Pro Max (large screen)
- [ ] iPad (tablet)

### Android Devices
- [ ] Small phone (< 5")
- [ ] Standard phone (5-6")
- [ ] Large phone (> 6")
- [ ] Tablet

### OS Versions
- [ ] iOS 15+
- [ ] Android 10+

## Bug Reporting Template

```
**Test Case**: TC-XXX
**Device**: [iOS/Android] [Device Model] [OS Version]
**Steps to Reproduce**:
1. 
2. 
3. 

**Expected Result**: 
**Actual Result**: 
**Severity**: [Critical/High/Medium/Low]
**Screenshots**: [Attach if applicable]
**Additional Notes**: 
```

## Sign-off Checklist

- [ ] All test cases executed
- [ ] Performance tests passed
- [ ] Accessibility tests passed
- [ ] Cross-device testing complete
- [ ] No critical bugs found
- [ ] Documentation reviewed
- [ ] Screenshots taken
- [ ] Ready for production

## Notes

- Test with clean app state (uninstall/reinstall between tests)
- Use different test accounts for each test case
- Clear AsyncStorage between tests when needed:
  ```javascript
  await AsyncStorage.clear();
  ```
- Monitor console logs for errors
- Take screenshots of each slide for documentation
