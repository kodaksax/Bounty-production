# Onboarding Carousel Manual Test

## Test Date: 2025-11-13

## Purpose
Validate the new onboarding carousel flow with feature introduction screens, skip functionality, and first-launch detection.

## Test Scenarios

### 1. First-Time User Sign-Up Flow
**Steps:**
1. Clear app data and AsyncStorage (or use new account)
2. Navigate to sign-up screen
3. Complete sign-up form with valid credentials
4. Submit registration

**Expected Results:**
- [ ] User is redirected to onboarding carousel (not directly to username screen)
- [ ] Carousel shows 4 feature screens with smooth animations
- [ ] Skip button appears in top-right corner
- [ ] Dot indicators show current screen position
- [ ] "Next" button advances to next screen
- [ ] Last screen shows "Get Started" button instead of "Next"
- [ ] AsyncStorage key `@bounty_onboarding_complete` is set to 'true' after completion

### 2. Carousel Navigation
**Steps:**
1. View first carousel screen
2. Tap "Next" button
3. Repeat for all screens
4. Observe animations

**Expected Results:**
- [ ] Screen 1: "Post Tasks & Earn" with work icon
- [ ] Screen 2: "Connect with Locals" with people icon  
- [ ] Screen 3: "Real-time Chat" with chat icon
- [ ] Screen 4: "Safe & Secure" with verified icon
- [ ] Each screen has smooth fade and scale animations
- [ ] Horizontal scrolling works with finger swipes
- [ ] Dot indicators animate width and opacity
- [ ] All text is readable on emerald background

### 3. Skip Functionality
**Steps:**
1. Start carousel from first screen
2. Tap "Skip" button in top-right

**Expected Results:**
- [ ] User is immediately taken to username screen
- [ ] AsyncStorage key `@bounty_onboarding_complete` is set to 'true'
- [ ] Remaining carousel screens are not shown

### 4. Returning User (Carousel Already Seen)
**Steps:**
1. Complete onboarding flow once
2. Sign out
3. Sign back in (or restart app)
4. Navigate through sign-in

**Expected Results:**
- [ ] Carousel is NOT shown again
- [ ] If profile incomplete, user goes directly to username screen
- [ ] If profile complete, user goes to main app

### 5. Enhanced Details Screen - Bio Field
**Steps:**
1. Complete username screen
2. Navigate to details screen
3. Enter text in bio field
4. Type more than 200 characters

**Expected Results:**
- [ ] Bio field is multi-line (3 lines visible)
- [ ] Character counter shows "0/200" initially
- [ ] Counter updates as user types
- [ ] Field enforces 200 character limit
- [ ] Bio text is optional (can skip)

### 6. Enhanced Details Screen - Skills Selection
**Steps:**
1. On details screen, view skills section
2. Tap several common skill chips (e.g., "Handyman", "Cleaning")
3. Add a custom skill in the input field
4. Press enter or tap the "+" button
5. Remove a custom skill

**Expected Results:**
- [ ] 10 common skills displayed as chips
- [ ] Tapped skills change background to emerald (#a7f3d0)
- [ ] Tapped skills change text color to dark (#052e1b)
- [ ] Multiple skills can be selected
- [ ] Custom skill input appears below common skills
- [ ] Custom skills show with different styling
- [ ] Custom skills have close (X) button
- [ ] Tapping X removes custom skill
- [ ] Skills are optional (can skip)

### 7. Profile Data Persistence
**Steps:**
1. Fill in all fields in details screen (name, bio, location, skills, avatar)
2. Tap "Next"
3. Complete phone screen
4. View done screen summary
5. Go to profile screen in main app

**Expected Results:**
- [ ] All entered data is saved to local storage
- [ ] Data syncs to Supabase
- [ ] Done screen shows entered username and details
- [ ] Profile screen displays bio and skills
- [ ] Avatar is uploaded and displayed correctly

### 8. Data Model Validation
**Steps:**
1. Check ProfileData interface usage
2. Verify fields in storage

**Expected Results:**
- [ ] `bio?: string` field exists in ProfileData
- [ ] `skills?: string[]` field exists in ProfileData
- [ ] Both useUserProfile and userProfile service have matching interfaces
- [ ] AsyncStorage properly stores bio and skills arrays

### 9. Animation Performance
**Steps:**
1. Swipe quickly between carousel screens
2. Scroll back and forth multiple times
3. Test on slow device if possible

**Expected Results:**
- [ ] Animations are smooth (60fps)
- [ ] No lag or stuttering during swipes
- [ ] Dot animations are synchronized with scroll
- [ ] Scale and opacity transitions are fluid

### 10. Edge Cases
**Steps:**
Test unusual inputs and flows

**Expected Results:**
- [ ] Empty bio doesn't cause errors
- [ ] Empty skills array is handled
- [ ] Very long skill names wrap properly
- [ ] Pressing back from carousel works
- [ ] App doesn't crash when skipping all fields
- [ ] Rapid tapping of Next/Skip doesn't cause issues

## Accessibility Checks
- [ ] All buttons have adequate touch targets (min 44x44)
- [ ] Text has sufficient contrast on emerald background
- [ ] Screen reader can announce carousel content
- [ ] Skip button is easily discoverable

## Visual Consistency
- [ ] Emerald theme consistent throughout (#059669, #a7f3d0)
- [ ] Spacing matches other onboarding screens
- [ ] Icons and text are properly aligned
- [ ] Progress dots match existing pattern
- [ ] Button styles match existing CTAs

## Security Considerations
- [ ] No sensitive data in AsyncStorage key names
- [ ] Bio and skills are properly sanitized before storage
- [ ] No XSS vulnerabilities in skill display
- [ ] Avatar upload uses secure service

## Notes
- AsyncStorage key used: `@bounty_onboarding_complete`
- Common skills: Handyman, Cleaning, Moving, Delivery, Pet Care, Gardening, Photography, Tutoring, Tech Support, Design
- Bio character limit: 200 characters
- Skills stored as string array

## Test Results Summary
**Pass/Fail:** _________
**Tester:** _________
**Date:** _________
**Issues Found:** _________
