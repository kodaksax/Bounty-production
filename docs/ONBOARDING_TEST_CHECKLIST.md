# Onboarding Flow Test Checklist

## Prerequisites
- App is running: `npm start`
- React Native debugger is open (optional but helpful)

## Test 1: New User Flow (Complete Onboarding)

### Setup
```javascript
// In React Native debugger console
clearProfileForTesting()
// Then reload app (Cmd+R or Ctrl+R)
```

### Steps
1. **App Launch**
   - [ ] App redirects to Username screen automatically
   - [ ] Username screen shows with emerald theme
   - [ ] Progress dots show 1/4 active

2. **Username Screen**
   - [ ] Try invalid usernames:
     - "ab" → Error: "at least 3 characters"
     - "ThisIsATest" → Error: "lowercase"
     - "test-user" → Error: "lowercase letters, numbers, and underscores"
     - "a_very_long_username_that_exceeds_twenty_chars" → Error: "20 characters or less"
   - [ ] Enter valid username: "testuser123"
   - [ ] Check mark appears next to input
   - [ ] "Next" button becomes enabled
   - [ ] Tap "Next"
   - [ ] Navigates to Details screen

3. **Details Screen**
   - [ ] Progress dots show 2/4 active
   - [ ] Back button works
   - [ ] Enter display name: "Test User"
   - [ ] Enter location: "San Francisco, CA"
   - [ ] Avatar placeholder shows "Coming Soon"
   - [ ] Tap "Next"
   - [ ] Navigates to Phone screen
   - [ ] Test "Skip for now" - should skip to Phone screen

4. **Phone Screen**
   - [ ] Progress dots show 3/4 active
   - [ ] Back button works
   - [ ] Privacy note displays: "never be shown to other users"
   - [ ] Lock icon visible
   - [ ] Enter phone: "(415) 555-1234"
   - [ ] Phone formats as you type
   - [ ] Info box explains usage
   - [ ] Tap "Next"
   - [ ] Navigates to Done screen
   - [ ] Test "Skip for now" - should skip to Done screen

5. **Done Screen**
   - [ ] Progress dots show 4/4 active
   - [ ] Check mark animation plays
   - [ ] Welcome message shows: "Welcome to Bounty, @testuser123!"
   - [ ] Summary card shows:
     - Username: @testuser123
     - Display Name: Test User
     - Location: San Francisco, CA
     - Phone: ✓ Added (private) ← NOT the actual number!
   - [ ] "Continue to Bounty" button visible
   - [ ] Tap "Continue to Bounty"
   - [ ] Navigates to main app (Profile screen)

6. **Profile Screen**
   - [ ] Profile shows display name and username
   - [ ] Location appears in skills/info
   - [ ] Phone verification badge shows (but NOT the actual number)
   - [ ] BottomNav is visible

## Test 2: Restart App (No Re-Onboarding)

### Steps
1. **Restart the app**
   - Kill and restart the app
   - [ ] App opens directly to main dashboard (Bounty screen)
   - [ ] No onboarding screens appear
   - [ ] Profile data is preserved

2. **Verify Profile**
   - Navigate to Profile screen
   - [ ] Username is "testuser123"
   - [ ] Display name is "Test User"
   - [ ] Location is "San Francisco, CA"
   - [ ] Phone number is NEVER visible anywhere

## Test 3: Phone Privacy Verification

### Steps
1. **Check Profile Screen**
   - [ ] Phone number does NOT appear in main profile display
   - [ ] Only a "verified contact" badge or similar shows

2. **Check Edit Profile Screen**
   - Navigate to Settings → Edit Profile
   - [ ] Phone field shows "***-***-****" or "Private"
   - [ ] Phone is not editable from this screen
   - [ ] Message indicates it's managed separately

3. **Check Console Logs**
   - Look at React Native logs
   - [ ] Any phone logs show sanitized format: "+14***34"
   - [ ] Full phone number is NEVER in plain text in logs

## Test 4: Username Uniqueness

### Setup
```javascript
// Create a profile
setTestProfile()
// Then clear and try to create same username
clearProfileForTesting()
```

### Steps
1. Go through onboarding
2. Try to use username "testuser"
   - [ ] Error appears: "Username is already taken"
   - [ ] "Next" button stays disabled
3. Change to "testuser2"
   - [ ] Validation passes
   - [ ] Can proceed

## Test 5: Skip Optional Fields

### Setup
```javascript
clearProfileForTesting()
```

### Steps
1. **Username only**
   - Enter username: "minimaluser"
   - Tap "Next"
   - Skip Details (tap "Skip for now")
   - Skip Phone (tap "Skip for now")
   - [ ] Done screen shows only username
   - [ ] No display name, location, or phone in summary
   - [ ] Can still complete onboarding

2. **Verify Profile**
   - [ ] Profile shows @minimaluser
   - [ ] No location in skills
   - [ ] No phone verification badge
   - [ ] App works normally

## Test 6: Back Navigation

### Steps
1. Start onboarding
2. From Username → enter valid username → Next
3. From Details → tap Back button
   - [ ] Returns to Username screen
   - [ ] Username is preserved
4. From Details → Next
5. From Phone → tap Back button
   - [ ] Returns to Details screen
   - [ ] Details are preserved
6. Complete onboarding normally

## Test 7: Validation Edge Cases

### Username
- [ ] Empty → "Next" disabled
- [ ] "a" → Too short error
- [ ] "aaaaaaaaaaaaaaaaaaaaa" (21 chars) → Too long error
- [ ] "Test123" → Uppercase error
- [ ] "test@123" → Special char error
- [ ] "test 123" → Space error
- [ ] "test_123" → Valid ✓
- [ ] "test123" → Valid ✓
- [ ] "test_user_123" → Valid ✓

### Phone
- [ ] Empty → Allowed (optional)
- [ ] "4155551234" → Formats to "+14155551234"
- [ ] "(415) 555-1234" → Formats to "+14155551234"
- [ ] "415-555-1234" → Formats to "+14155551234"
- [ ] "+441234567890" → Preserves international format

## Test 8: BottomNav Integration

### Steps
1. Complete onboarding
2. Navigate to each tab:
   - [ ] Bounty (dashboard) - works
   - [ ] Wallet - works
   - [ ] Create (messenger) - works
   - [ ] Postings - works
   - [ ] Profile - works
3. [ ] BottomNav stays at bottom
4. [ ] Content doesn't get hidden behind nav
5. [ ] Safe areas respected on iOS

## Test 9: Edit Profile Integration

### Steps
1. Complete onboarding with all fields
2. Go to Profile → Settings → Edit Profile
3. [ ] Phone field shows masked value
4. [ ] Phone field is NOT editable
5. [ ] Can edit name and about
6. [ ] Saving changes works
7. [ ] Phone remains private

## Success Criteria

All checkboxes should be checked ✓

## Known Limitations (Future Work)
- Avatar upload not implemented (placeholder only)
- Server-side username uniqueness check is a stub
- SMS verification not implemented
- Email integration pending
- No profile picture cropping
- Settings doesn't link to re-edit phone (by design for security)

## Reporting Issues

If any test fails:
1. Note which test and step failed
2. Check React Native console for errors
3. Check browser/debugger console for warnings
4. Take screenshot if UI issue
5. Note device/simulator being used
6. File issue with details
