# Authentication & Profile Integration Test Plan

## Test Suite: Authentication & Profile Integration

### Test Environment Setup
- Ensure Supabase is configured with valid credentials
- Create test user accounts in Supabase auth
- Ensure profiles table exists and is accessible
- Clear AsyncStorage before each test session

## Unit Tests

### 1. AuthProfileService Tests

#### Test 1.1: Session Sync
**Given**: A valid Supabase session
**When**: `authProfileService.setSession(session)` is called
**Then**: 
- Service should fetch user profile from Supabase
- Profile should be cached locally
- Listeners should be notified with profile data

#### Test 1.2: Profile Creation
**Given**: A new user without a profile
**When**: Session is set for new user
**Then**:
- Minimal profile should be created automatically
- Profile should have username from email
- Profile should have balance = 0

#### Test 1.3: Profile Update
**Given**: An authenticated user with existing profile
**When**: `authProfileService.updateProfile({ about: 'New bio' })` is called
**Then**:
- Profile should be updated in Supabase
- Local cache should be updated
- Listeners should be notified with updated profile

#### Test 1.4: Cache Expiry
**Given**: A cached profile older than 5 minutes
**When**: Profile is accessed
**Then**:
- Fresh profile should be fetched from Supabase
- Cache should be updated with new timestamp

#### Test 1.5: Offline Behavior
**Given**: No network connectivity
**When**: Profile is accessed
**Then**:
- Cached profile should be returned
- No error should be thrown
- Error should be logged

### 2. useAuthProfile Hook Tests

#### Test 2.1: Initial Load
**Given**: Component mounts with authenticated user
**When**: `useAuthProfile()` is called
**Then**:
- `loading` should be true initially
- `profile` should be null initially
- After load: `loading` false, `profile` populated

#### Test 2.2: Profile Updates
**Given**: Component using `useAuthProfile`
**When**: Profile is updated elsewhere
**Then**:
- Component should re-render with new profile data
- No memory leaks should occur

#### Test 2.3: Unsubscribe
**Given**: Component unmounts
**When**: Component cleanup runs
**Then**:
- Subscription should be cleaned up
- No memory leaks
- No errors in console

### 3. getCurrentUserId Tests

#### Test 3.1: Authenticated User
**Given**: User is logged in
**When**: `getCurrentUserId()` is called
**Then**: Should return authenticated user ID

#### Test 3.2: Unauthenticated User
**Given**: No user logged in
**When**: `getCurrentUserId()` is called
**Then**: Should return fallback ID `00000000-0000-0000-0000-000000000001`

## Integration Tests

### 4. Profile Screen Integration

#### Test 4.1: Profile Display
**Given**: User is logged in
**When**: Profile screen is opened
**Then**:
- Username should be displayed correctly
- Avatar should be displayed
- About section should show user's bio
- Statistics should show correct counts

#### Test 4.2: Profile Edit
**Given**: User opens edit profile
**When**: User changes bio and saves
**Then**:
- Changes should persist to Supabase
- Profile screen should update immediately
- Refresh should show persisted changes

#### Test 4.3: Profile Refresh
**Given**: User pulls to refresh profile
**When**: Refresh completes
**Then**:
- Latest profile data should be fetched
- UI should update with fresh data
- Loading indicator should show/hide correctly

### 5. Bounty Creation Integration

#### Test 5.1: Create Bounty as Authenticated User
**Given**: User is logged in
**When**: User creates a bounty
**Then**:
- Bounty should have correct `user_id`
- Bounty should appear in "My Postings"
- Bounty should show correct username

#### Test 5.2: View Own Bounties
**Given**: User has created bounties
**When**: User opens "My Postings" tab
**Then**:
- Only user's bounties should be displayed
- Correct count should be shown
- Each bounty should have correct user_id

#### Test 5.3: View Others' Bounties
**Given**: Other users have created bounties
**When**: User views bounty list
**Then**:
- Other users' bounties should show their usernames
- Current user's bounties should show "You" or their username
- Correct attribution for all bounties

### 6. Messenger Integration

#### Test 6.1: Conversation Filtering
**Given**: User has conversations
**When**: Messenger screen loads
**Then**:
- Only conversations involving current user should show
- Correct participant names should display
- Current user should not appear as "other participant"

#### Test 6.2: Message Sending
**Given**: User is in a conversation
**When**: User sends a message
**Then**:
- Message should have correct sender ID
- Message should appear with correct attribution
- Other user should see message from correct sender

### 7. Profile Routes Integration

#### Test 7.1: Own Profile Route
**Given**: User navigates to `/profile`
**When**: Route resolves
**Then**:
- Should redirect to `/profile/{currentUserId}`
- Should show edit button
- Should not show follow button

#### Test 7.2: Other User Profile Route
**Given**: User navigates to `/profile/{otherUserId}`
**When**: Profile loads
**Then**:
- Should show other user's data
- Should show follow button
- Should not show edit button

#### Test 7.3: Profile Edit Route
**Given**: User navigates to `/profile/edit`
**When**: Edit screen loads
**Then**:
- Should load current user's profile data
- Should allow editing
- Should save to correct user profile

## End-to-End Tests

### 8. Complete User Journey

#### Test 8.1: Registration to First Bounty
1. **Step 1**: Register new user
   - Profile should be created automatically
   - Default values should be set
2. **Step 2**: Edit profile
   - Add bio and avatar
   - Changes should save
3. **Step 3**: Create first bounty
   - Bounty should have correct user_id
   - Should appear in My Postings
4. **Step 4**: View profile
   - Updated info should display
   - Statistics should show 1 bounty posted

#### Test 8.2: Multi-Session Consistency
1. **Step 1**: Login on Device A
   - Profile loads correctly
2. **Step 2**: Edit profile on Device A
   - Changes save to Supabase
3. **Step 3**: Login on Device B
   - Should see updated profile
   - No stale data

#### Test 8.3: Logout and Re-login
1. **Step 1**: User logs out
   - Profile cache cleared
   - Auth session cleared
2. **Step 2**: User logs back in
   - Profile fetched fresh
   - All user data restored
   - Context preserved across app

## Performance Tests

### 9. Load Performance

#### Test 9.1: Initial Load Time
**Given**: App cold start
**When**: User logs in
**Then**: Profile should load within 2 seconds

#### Test 9.2: Navigation Performance
**Given**: User navigates between screens
**When**: Each screen loads
**Then**: User ID should be available immediately (no delay)

#### Test 9.3: Cache Hit Rate
**Given**: Multiple profile accesses within 5 minutes
**When**: Profile is accessed
**Then**: Should use cache (no network call)

## Error Handling Tests

### 10. Error Scenarios

#### Test 10.1: Supabase Offline
**Given**: Supabase is unreachable
**When**: User tries to update profile
**Then**:
- Error message should display
- App should not crash
- Cached data should still be available

#### Test 10.2: Invalid Session
**Given**: Session token expired
**When**: User tries to access profile
**Then**:
- User should be prompted to re-login
- No crash or undefined errors
- Graceful degradation

#### Test 10.3: Network Timeout
**Given**: Slow network connection
**When**: Profile fetch times out
**Then**:
- Loading indicator should show
- Timeout should be handled gracefully
- Retry option should be available

## Regression Tests

### 11. Backward Compatibility

#### Test 11.1: Legacy CURRENT_USER_ID Usage
**Given**: Old code using `CURRENT_USER_ID`
**When**: Code executes
**Then**:
- Should still work (fallback behavior)
- No errors in console
- Consider migration warning

#### Test 11.2: Old Profile Service Compatibility
**Given**: Components using old `useUserProfile`
**When**: Profile is updated
**Then**:
- Both services should stay in sync
- No conflicts
- Data consistency maintained

## Security Tests

### 12. Authorization

#### Test 12.1: Profile Edit Authorization
**Given**: User tries to edit another user's profile
**When**: Update is attempted
**Then**:
- Should fail with authorization error
- No data should be changed
- Error should be logged

#### Test 12.2: Bounty Ownership
**Given**: User tries to modify another user's bounty
**When**: Update is attempted
**Then**:
- Should fail with authorization error
- Bounty should remain unchanged

#### Test 12.3: Profile Data Privacy
**Given**: User views another user's profile
**When**: Profile is displayed
**Then**:
- Phone number should NOT be visible
- Email should NOT be visible
- Only public data should show

## Test Execution Checklist

### Prerequisites
- [ ] Supabase configured with valid credentials
- [ ] Test user accounts created
- [ ] Database schema up to date
- [ ] App built successfully
- [ ] Test device/simulator ready

### Execution Order
1. [ ] Run unit tests
2. [ ] Run integration tests
3. [ ] Run end-to-end tests
4. [ ] Run performance tests
5. [ ] Run error handling tests
6. [ ] Run regression tests
7. [ ] Run security tests

### Success Criteria
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] No console errors during test execution
- [ ] No memory leaks detected
- [ ] App remains responsive during all operations
- [ ] All security tests pass
- [ ] Performance within acceptable limits

### Known Issues / Limitations
- TypeScript strict mode warnings in some legacy files (not profile-related)
- Cache expiry is fixed at 5 minutes (consider making configurable)
- Network timeout handling could be more sophisticated

---

**Test Plan Version**: 1.0.0
**Last Updated**: 2025-10-10
**Status**: Ready for Execution
