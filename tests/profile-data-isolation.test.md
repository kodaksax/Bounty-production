# Profile Data Isolation Test Plan

## Test Suite: Edit Profile Data Leak Prevention

### Purpose
Verify that profile edit screens do not leak data between different user sessions, ensuring each user only sees and edits their own profile data.

### Test Environment Setup
- Ensure Supabase is configured with valid credentials
- Create at least 2 test user accounts in Supabase auth
- Clear AsyncStorage before each test session
- Ensure auth-profile-service is properly initialized

## Critical Security Tests

### Test 1: Draft Data Isolation Between Users

#### Test 1.1: User-Specific Draft Keys
**Given**: Two users (User A and User B) logged in sequentially
**When**: 
1. User A logs in and navigates to edit profile
2. User A enters draft data (name: "Alice", bio: "Alice's bio")
3. User A logs out without saving
4. User B logs in and navigates to edit profile
**Then**:
- User B should NOT see User A's draft data
- User B's form should be empty or contain User B's existing profile data only
- AsyncStorage should contain separate draft keys for each user:
  - `editProfile:draft:{userA_id}` contains User A's draft
  - `editProfile:draft:{userB_id}` contains User B's draft (if any)

**Verification**:
```javascript
// Check AsyncStorage keys
const userADraftKey = `editProfile:draft:${userA.id}`;
const userBDraftKey = `editProfile:draft:${userB.id}`;

// User A's draft should exist
const userADraft = await AsyncStorage.getItem(userADraftKey);
expect(userADraft).toContain('Alice');

// User B's form should not contain User A's data
const userBDraft = await AsyncStorage.getItem(userBDraftKey);
expect(userBDraft).not.toContain('Alice');
```

#### Test 1.2: Profile Cache Isolation
**Given**: Two users logged in sequentially
**When**:
1. User A logs in (profile cached)
2. User A logs out
3. User B logs in
**Then**:
- User B should see their own profile, not User A's cached profile
- Profile cache keys should be user-specific:
  - `BE:authProfile:{userA_id}` contains User A's profile
  - `BE:authProfile:{userB_id}` contains User B's profile

**Verification**:
```javascript
// Check profile cache keys
const userACacheKey = `BE:authProfile:${userA.id}`;
const userBCacheKey = `BE:authProfile:${userB.id}`;

const userACache = await AsyncStorage.getItem(userACacheKey);
expect(JSON.parse(userACache).profile.username).toBe('userA');

const userBCache = await AsyncStorage.getItem(userBCacheKey);
expect(JSON.parse(userBCache).profile.username).toBe('userB');
```

### Test 2: Session-Based Profile Loading

#### Test 2.1: Current User ID from Session
**Given**: User is logged in
**When**: Edit profile screen loads
**Then**:
- `currentUserId` should be derived from active session
- `currentUserId` should match `session?.user?.id`
- Profile data should match the authenticated user

**Verification**:
```javascript
// In app/profile/edit.tsx
const { session } = useAuthContext();
const currentUserId = session?.user?.id || getCurrentUserId();
const { profile } = useNormalizedProfile(currentUserId);

expect(currentUserId).toBe(session.user.id);
expect(profile.id).toBe(currentUserId);
```

#### Test 2.2: Form Reset on User Change
**Given**: User logs in and opens edit profile
**When**: User switches accounts (logout and login as different user)
**Then**:
- Form should reset completely
- No previous user's data should persist in form state
- Draft should be cleared or loaded from new user's draft

**Verification**:
```javascript
// Form should reset when currentUserId changes
useEffect(() => {
  // Form reset logic
  setFormData(newUserData);
}, [currentUserId]);
```

### Test 3: Logout Data Cleanup

#### Test 3.1: Draft Cleanup on Logout
**Given**: User A has unsaved draft data
**When**: User A logs out
**Then**:
- User A's draft data should be cleared from AsyncStorage
- User A's profile cache should be cleared
- No residual data should remain that could leak to next user

**Verification**:
```javascript
// In settings-screen.tsx logout handler
const currentUserId = authProfile?.id;
await authProfileService.clearUserDraftData(currentUserId);

// Verify cleanup
const draftKey = `editProfile:draft:${currentUserId}`;
const draft = await AsyncStorage.getItem(draftKey);
expect(draft).toBeNull();
```

#### Test 3.2: Cache Cleanup on Logout
**Given**: User is logged in with cached profile
**When**: User logs out
**Then**:
- Profile cache for that user should be removed
- Auth session should be cleared
- authProfileService should have null currentProfile

**Verification**:
```javascript
await supabase.auth.signOut();
expect(authProfileService.getCurrentProfile()).toBeNull();
expect(authProfileService.getAuthUserId()).toBeNull();
```

### Test 4: Multi-User Session Switching

#### Test 4.1: Rapid User Switching
**Given**: App is open
**When**:
1. User A logs in
2. User A navigates to edit profile (form loads)
3. User A logs out
4. User B logs in immediately
5. User B navigates to edit profile
**Then**:
- User B should see only their own data
- No race conditions should cause User A's data to appear
- Form should be properly reset

**Verification**: Manual test with rapid switching

#### Test 4.2: Concurrent User Sessions (Web/Mobile)
**Given**: User A is logged in on Device 1
**When**:
1. User B logs in on Device 2 (same physical device, different session)
2. Both navigate to edit profile
**Then**:
- Each session should see only their own data
- No cross-contamination between sessions
- AsyncStorage keys should be properly scoped

**Verification**: Test on web and mobile simulators simultaneously

### Test 5: Edge Cases

#### Test 5.1: Unauthenticated User
**Given**: No user is logged in
**When**: User tries to access edit profile
**Then**:
- Should redirect to login
- No profile data should be displayed
- No errors should occur

#### Test 5.2: Session Expiry During Editing
**Given**: User is editing profile
**When**: Session expires mid-edit
**Then**:
- User should be notified
- Unsaved changes should be preserved (if possible)
- User should be prompted to re-authenticate
- After re-auth, draft should be restored

#### Test 5.3: Invalid User ID
**Given**: User ID becomes invalid or undefined
**When**: Edit profile screen attempts to load
**Then**:
- Should handle gracefully
- Should not crash
- Should show error message
- Should redirect to safe state

## Manual Testing Checklist

### Pre-Test Setup
- [ ] Create User A test account (e.g., `testA@example.com`)
- [ ] Create User B test account (e.g., `testB@example.com`)
- [ ] Clear all AsyncStorage data
- [ ] Ensure Supabase is properly configured
- [ ] Build and run the app

### Test Execution

#### Scenario 1: Basic Data Isolation
- [ ] Log in as User A
- [ ] Navigate to Edit Profile
- [ ] Enter test data: Name="Test User A", Bio="This is User A's bio"
- [ ] Leave form WITHOUT saving (data should be in draft)
- [ ] Log out
- [ ] Log in as User B
- [ ] Navigate to Edit Profile
- [ ] **Verify**: Form should be empty or show User B's data, NOT User A's draft
- [ ] **Result**: PASS / FAIL

#### Scenario 2: Draft Persistence Per User
- [ ] Log in as User A
- [ ] Navigate to Edit Profile
- [ ] Enter draft data for User A
- [ ] Go back (don't save)
- [ ] Log out and log back in as User A
- [ ] Navigate to Edit Profile
- [ ] **Verify**: Draft data should be restored for User A
- [ ] Log out
- [ ] Log in as User B
- [ ] Navigate to Edit Profile
- [ ] **Verify**: User B should not see User A's draft
- [ ] **Result**: PASS / FAIL

#### Scenario 3: Cache Isolation
- [ ] Log in as User A
- [ ] View profile (triggers cache)
- [ ] Log out
- [ ] Log in as User B
- [ ] View profile
- [ ] **Verify**: User B sees their own profile, not User A's cached data
- [ ] **Result**: PASS / FAIL

#### Scenario 4: Logout Cleanup
- [ ] Log in as User A
- [ ] Navigate to Edit Profile and create draft
- [ ] Log out
- [ ] Use AsyncStorage inspector to check keys
- [ ] **Verify**: User A's draft key should be cleared
- [ ] **Verify**: User A's profile cache should be cleared
- [ ] **Result**: PASS / FAIL

## Automated Test Template

```typescript
// tests/profile-data-isolation.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authProfileService } from '../lib/services/auth-profile-service';
import { supabase } from '../lib/supabase';

describe('Profile Data Isolation', () => {
  const userAEmail = 'testA@example.com';
  const userBEmail = 'testB@example.com';
  const testPassword = 'test123456';
  
  let userAId: string;
  let userBId: string;
  
  beforeAll(async () => {
    // Setup test users
    // Note: Create these users in Supabase first
  });
  
  afterEach(async () => {
    // Cleanup
    await supabase.auth.signOut();
    await AsyncStorage.clear();
  });
  
  test('User B should not see User A draft data', async () => {
    // Log in as User A
    const { data: userASession } = await supabase.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    userAId = userASession.session.user.id;
    
    // Simulate User A creating draft
    const userADraftKey = `editProfile:draft:${userAId}`;
    const userADraft = {
      name: 'User A',
      bio: 'User A bio',
    };
    await AsyncStorage.setItem(userADraftKey, JSON.stringify(userADraft));
    
    // Log out User A
    await supabase.auth.signOut();
    await authProfileService.clearUserDraftData(userAId);
    
    // Log in as User B
    const { data: userBSession } = await supabase.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
    userBId = userBSession.session.user.id;
    
    // Check User B's draft key
    const userBDraftKey = `editProfile:draft:${userBId}`;
    const userBDraft = await AsyncStorage.getItem(userBDraftKey);
    
    // User B should not have User A's draft
    expect(userBDraft).not.toContain('User A');
    
    // User A's draft should not exist (cleared on logout)
    const userADraftAfterLogout = await AsyncStorage.getItem(userADraftKey);
    expect(userADraftAfterLogout).toBeNull();
  });
  
  test('Profile cache should be user-specific', async () => {
    // Log in as User A
    const { data: userASession } = await supabase.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    userAId = userASession.session.user.id;
    
    // Fetch and cache User A's profile
    await authProfileService.setSession(userASession.session);
    const userAProfile = authProfileService.getCurrentProfile();
    
    // Log out and log in as User B
    await supabase.auth.signOut();
    const { data: userBSession } = await supabase.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
    userBId = userBSession.session.user.id;
    
    // Fetch User B's profile
    await authProfileService.setSession(userBSession.session);
    const userBProfile = authProfileService.getCurrentProfile();
    
    // Profiles should be different
    expect(userAProfile.id).not.toBe(userBProfile.id);
    expect(userAProfile.username).not.toBe(userBProfile.username);
    
    // Check cache keys are separate
    const userACacheKey = `BE:authProfile:${userAId}`;
    const userBCacheKey = `BE:authProfile:${userBId}`;
    
    const userACache = await AsyncStorage.getItem(userACacheKey);
    const userBCache = await AsyncStorage.getItem(userBCacheKey);
    
    expect(userACache).toBeTruthy();
    expect(userBCache).toBeTruthy();
    expect(userACache).not.toBe(userBCache);
  });
});
```

## Success Criteria

### Must Pass
- [ ] No user can see another user's draft data
- [ ] Profile cache is properly isolated per user
- [ ] Logout clears all user-specific data
- [ ] Form resets when user changes
- [ ] No race conditions in rapid switching

### Should Pass
- [ ] Draft data persists across app restarts for same user
- [ ] Profile updates only affect current user
- [ ] No console errors during user switching
- [ ] AsyncStorage keys follow naming convention

### Performance
- [ ] User switching completes within 1 second
- [ ] Draft save is debounced (250ms)
- [ ] No memory leaks during repeated switching

## Known Issues / Limitations
- Draft data is stored in plain text (consider encryption for sensitive fields)
- Cache expiry is global (5 minutes) - consider per-user expiry
- No automated cleanup of old user drafts (consider adding TTL)

---

**Test Plan Version**: 1.0.0
**Created**: 2025-10-15
**Status**: Ready for Execution
**Related Issue**: Profile data leak between users in edit profile screens
