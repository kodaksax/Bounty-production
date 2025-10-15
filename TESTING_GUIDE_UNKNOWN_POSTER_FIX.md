# Testing Guide: Unknown Poster Fix

This guide helps verify that the "Unknown Poster" fix is working correctly.

## Prerequisites

Before testing, ensure:
1. ✅ Supabase is configured and connected
2. ✅ Database has profiles table with usernames and avatars
3. ✅ Database has bounties with valid user_id references to profiles
4. ✅ App is running: `npm start`

## Test Scenarios

### Scenario 1: Bounty List - Username Display ✅

**Location**: Dashboard / Bounty List Screen

**Test Steps**:
1. Navigate to the bounty list (main dashboard)
2. Observe the list of bounties

**Expected Results**:
- ✅ Each bounty shows a username (e.g., "john_doe")
- ❌ NO "Unknown Poster" text should be visible
- ✅ Username appears immediately (no loading delay)
- ✅ If username is missing, should show "Loading..." briefly then fallback

**Screenshots to Capture**:
- [ ] Full bounty list showing multiple usernames
- [ ] Close-up of single bounty item with username visible

---

### Scenario 2: Bounty List - Avatar Display ✅

**Location**: Dashboard / Bounty List Screen

**Test Steps**:
1. Navigate to the bounty list
2. Look at the left side of each bounty item

**Expected Results**:
- ✅ Each bounty shows a circular avatar image
- ❌ NO generic icons (like coins or paid icons)
- ✅ Avatar shows user's profile picture OR
- ✅ Avatar shows text with user's initials if no picture (e.g., "JD")
- ✅ Avatar has emerald border/styling

**Screenshots to Capture**:
- [ ] Bounty with profile picture avatar
- [ ] Bounty with text initials avatar

---

### Scenario 3: Avatar Click Navigation ✅

**Location**: Dashboard / Bounty List Screen

**Test Steps**:
1. Click on an avatar in the bounty list
2. Observe what happens

**Expected Results**:
- ✅ Navigation occurs to the user's profile page
- ✅ URL changes to `/profile/{userId}`
- ✅ Profile page displays the correct user information
- ❌ Bounty detail modal should NOT open (avatar stops propagation)

**Screenshots to Capture**:
- [ ] Before click (bounty list)
- [ ] After click (profile page)
- [ ] URL bar showing /profile/{userId}

---

### Scenario 4: Bounty Detail Modal - Username & Avatar ✅

**Location**: Bounty Detail Modal

**Test Steps**:
1. Click on any bounty item (not the avatar) to open detail modal
2. Look at the top of the modal

**Expected Results**:
- ✅ Top section shows user avatar (circular, left side)
- ✅ Next to avatar shows username
- ✅ Below username shows "Posted Xh ago"
- ✅ Right side shows chevron icon (>)
- ✅ NO "Unknown Poster" text

**Screenshots to Capture**:
- [ ] Full bounty detail modal
- [ ] Close-up of user info section at top

---

### Scenario 5: Bounty Detail Modal - Profile Navigation ✅

**Location**: Bounty Detail Modal

**Test Steps**:
1. Open a bounty detail modal
2. Click on the entire user info section (avatar + username area)
3. Observe navigation

**Expected Results**:
- ✅ Modal closes
- ✅ Navigation to poster's profile page
- ✅ URL changes to `/profile/{userId}`

**Screenshots to Capture**:
- [ ] Profile page after navigation from modal

---

### Scenario 6: Profile Page - Avatar Display ✅

**Location**: Profile Page (/profile/{userId})

**Test Steps**:
1. Navigate to any user's profile
2. Look at the top center of the screen

**Expected Results**:
- ✅ Large circular avatar displays
- ✅ Shows user's profile picture OR
- ✅ Shows large text initials if no picture
- ✅ Avatar has emerald border
- ✅ Below avatar shows display name and @username

**Screenshots to Capture**:
- [ ] Profile page with picture avatar
- [ ] Profile page with text initials avatar

---

### Scenario 7: Visitor Mode - Own Profile ✅

**Location**: Profile Page (your own profile)

**Test Steps**:
1. Navigate to your own profile
2. Look at the action buttons

**Expected Results**:
- ✅ Shows "Edit Profile" button
- ❌ Does NOT show "Message" button
- ❌ Does NOT show "Follow" button

**Screenshots to Capture**:
- [ ] Own profile showing Edit Profile button

---

### Scenario 8: Visitor Mode - Other User's Profile ✅

**Location**: Profile Page (another user's profile)

**Test Steps**:
1. Navigate to another user's profile
2. Look at the action buttons

**Expected Results**:
- ❌ Does NOT show "Edit Profile" button
- ✅ Shows "Message" button
- ✅ Shows "Follow" button (if feature enabled)
- ✅ Cannot edit any profile information

**Screenshots to Capture**:
- [ ] Other user's profile showing Message and Follow buttons

---

### Scenario 9: Messenger - Avatar & Username ✅

**Location**: Messenger / Inbox Screen

**Test Steps**:
1. Navigate to Messenger/Inbox
2. Look at the conversation list

**Expected Results**:
- ✅ Each conversation shows user avatar
- ✅ Each conversation shows username
- ❌ NO "Unknown Poster" in conversation names
- ✅ Clicking avatar navigates to user profile

**Screenshots to Capture**:
- [ ] Messenger inbox with multiple conversations
- [ ] Profile page after clicking avatar from messenger

---

### Scenario 10: Performance Test ✅

**Location**: Dashboard / Bounty List Screen

**Test Steps**:
1. Clear app cache/data
2. Restart the app
3. Navigate to bounty list
4. Start timer when list appears
5. Observe when usernames are visible

**Expected Results**:
- ✅ Usernames visible immediately (< 200ms after list appears)
- ❌ NO delay showing "Unknown Poster" first
- ✅ Avatars load quickly
- ✅ Smooth scroll performance

**Metrics to Record**:
- [ ] Time to first username visible: ___ms
- [ ] Time to all usernames visible: ___ms
- [ ] Any "Unknown Poster" occurrences: Yes/No

---

### Scenario 11: Fallback Behavior ✅

**Location**: Any screen with bounties

**Test Steps**:
1. Create a test bounty with a user_id that has NO profile
2. View the bounty in the list

**Expected Results**:
- ✅ Shows "Loading..." briefly
- ✅ Falls back to "Unknown Poster" after loading
- ✅ Shows text avatar with "??" or "UN" initials
- ❌ Does NOT crash or show errors

**Screenshots to Capture**:
- [ ] Bounty with missing profile data

---

### Scenario 12: Applicant Cards - Requests Tab ✅

**Location**: Postings Screen > Requests Tab

**Test Steps**:
1. Navigate to Postings
2. Switch to "Requests" tab
3. Look at applicant cards

**Expected Results**:
- ✅ Each applicant shows avatar
- ✅ Each applicant shows username
- ✅ Clicking avatar/name navigates to applicant profile
- ❌ NO "Unknown User" text

**Screenshots to Capture**:
- [ ] Requests tab with applicant cards

---

## Database Verification

Run this SQL query in Supabase to verify data:

```sql
-- Check bounty-profile join
SELECT 
  b.id,
  b.title,
  b.user_id,
  p.username,
  p.avatar
FROM bounties b
LEFT JOIN profiles p ON b.user_id = p.id
WHERE b.status = 'open'
LIMIT 10;
```

**Expected Results**:
- ✅ All bounties have matching profiles
- ✅ username column is populated
- ✅ avatar column may be NULL (that's okay)

---

## API Testing

Run the test suite:

```bash
# If you have tests configured
npm test

# Or run the specific test file
ts-node tests/bounty-profile-integration.test.ts
```

**Expected Output**:
```
✓ Fetched X bounties
  - Bounties with username: X/X
  - Bounties with avatar: X/X
  ✅ Username field is working

✓ All tests completed successfully
```

---

## Checklist: What to Verify

### Data Display
- [ ] Usernames display in bounty list
- [ ] Avatars display in bounty list
- [ ] Usernames display in bounty detail modal
- [ ] Avatars display in bounty detail modal
- [ ] Avatars display on profile pages
- [ ] Usernames display in messenger

### Navigation
- [ ] Clicking avatar in bounty list navigates to profile
- [ ] Clicking user section in bounty modal navigates to profile
- [ ] Clicking avatar in messenger navigates to profile
- [ ] Clicking applicant card navigates to profile

### Visitor Mode
- [ ] Own profile shows "Edit Profile" button
- [ ] Other profiles show "Message" and "Follow" buttons
- [ ] Cannot edit other users' profiles

### Performance
- [ ] Usernames appear immediately (no loading delay)
- [ ] No "Unknown Poster" text visible
- [ ] Smooth scrolling in bounty list
- [ ] Fast page transitions

### Edge Cases
- [ ] Handles missing profile data gracefully
- [ ] Shows appropriate fallback for missing avatars
- [ ] Works with profiles that have no avatar set
- [ ] Works with very long usernames

---

## Troubleshooting

### Issue: Still seeing "Unknown Poster"

**Check**:
1. Is Supabase configured? Check `lib/supabase.ts`
2. Are profiles table and bounties table properly linked?
3. Does the profiles table have data?
4. Check console for any errors

**SQL to verify**:
```sql
SELECT COUNT(*) FROM profiles;
SELECT COUNT(*) FROM bounties WHERE user_id IS NULL;
```

### Issue: Avatars not displaying

**Check**:
1. Is `poster_avatar` field in the bounty object?
2. Check network tab for failed image loads
3. Verify avatar URLs are valid
4. Check if Avatar component is imported correctly

### Issue: Profile navigation not working

**Check**:
1. Is `user_id` present in bounty object?
2. Check console for navigation errors
3. Verify router.push is called with correct path
4. Check if profile page route exists

---

## Success Criteria

✅ **All tests passed if**:
- Zero "Unknown Poster" occurrences in normal usage
- All avatars display (either image or initials)
- All avatar clicks navigate to correct profiles
- Visitor mode works correctly (no unauthorized editing)
- Performance is smooth (< 200ms to show usernames)
- No console errors related to profiles/avatars

---

## Report Issues

If you find any issues during testing:

1. **Take a screenshot** of the issue
2. **Note the steps** to reproduce
3. **Check console** for error messages
4. **Check network tab** for failed requests
5. **Document** expected vs actual behavior

File issues with:
- Environment: iOS/Android/Web
- Device/Browser version
- Steps to reproduce
- Screenshots
- Console errors (if any)
