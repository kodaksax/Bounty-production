# Manual Profile Data Isolation Test

## Quick Test Guide for Verifying Profile Data Leak Fix

### Prerequisites
- Two test user accounts (we'll call them User A and User B)
- Access to React Native Debugger or similar tool to inspect AsyncStorage
- Clean app state (recommended: uninstall and reinstall app)

---

## Test 1: Edit Profile Draft Isolation (5 minutes)

### Steps:
1. **Login as User A**
   - Email: (your test user A)
   - Password: (your test password)

2. **Create Draft Data**
   - Navigate to: Profile → Settings → Edit Profile
   - Enter the following data:
     - Name: "Alice TestUser"
     - Bio: "This is Alice's unique bio text"
     - Location: "Alice City"
   - **Do NOT save** - Just press back/cancel
   - Logout

3. **Login as User B**
   - Email: (your test user B)
   - Password: (your test password)

4. **Check for Data Leak**
   - Navigate to: Profile → Settings → Edit Profile
   - **EXPECTED**: Form should be empty or show User B's existing data
   - **FAIL**: If you see "Alice TestUser" or "Alice's unique bio"

### Result:
- [ ] PASS: User B does not see User A's draft
- [ ] FAIL: User B sees User A's data

---

## Test 2: Skills Data Isolation (5 minutes)

### Steps:
1. **Login as User A**
   - Navigate to: Profile → Skillsets → Edit
   - Add a unique skill: "User A Special Skill"
   - Don't save, just go back
   - Logout

2. **Login as User B**
   - Navigate to: Profile → Skillsets → Edit
   - **EXPECTED**: Should NOT see "User A Special Skill"
   - **FAIL**: If User A's skill appears

### Result:
- [ ] PASS: User B does not see User A's skills
- [ ] FAIL: User B sees User A's skills

---

## Test 3: Profile Cache Isolation (3 minutes)

### Steps:
1. **Login as User A**
   - View Profile (this caches User A's profile)
   - Note User A's username/bio
   - Logout

2. **Login as User B**
   - View Profile immediately
   - **EXPECTED**: See User B's username/bio (not User A's)
   - **FAIL**: If User A's cached profile appears

### Result:
- [ ] PASS: User B sees their own profile
- [ ] FAIL: User B sees User A's cached profile

---

## Test 4: Logout Cleanup (5 minutes)

### Steps:
1. **Setup**: Login as User A and create some draft data

2. **Inspect AsyncStorage BEFORE Logout**:
   - Open React Native Debugger
   - Console: `AsyncStorage.getAllKeys().then(keys => console.log(keys))`
   - Look for keys like:
     - `editProfile:draft:{userA_id}`
     - `profileSkills:{userA_id}`
     - `BE:authProfile:{userA_id}`
   - These should exist

3. **Logout**: Profile → Settings → Log Out

4. **Inspect AsyncStorage AFTER Logout**:
   - Console: `AsyncStorage.getAllKeys().then(keys => console.log(keys))`
   - **EXPECTED**: User A's keys should be gone
   - **FAIL**: If User A's keys still exist

### Result:
- [ ] PASS: User-specific keys are cleaned up
- [ ] FAIL: Keys remain after logout

---

## Test 5: Rapid User Switching (3 minutes)

### Steps:
1. **Login as User A** → Navigate to Edit Profile
2. **Logout** → **Login as User B** (quickly)
3. **Navigate to Edit Profile**
4. **EXPECTED**: User B's data (no race condition)
5. **Logout** → **Login as User A** (quickly)
6. **Navigate to Edit Profile**
7. **EXPECTED**: User A's data

### Result:
- [ ] PASS: No cross-contamination during rapid switching
- [ ] FAIL: Wrong user's data appears

---

## Test 6: AsyncStorage Key Inspection (Developer Test)

### Using React Native Debugger:

```javascript
// In Console:

// Get all keys
AsyncStorage.getAllKeys().then(keys => {
  console.log('All AsyncStorage keys:', keys);
  
  // Filter for profile-related keys
  const profileKeys = keys.filter(k => 
    k.includes('editProfile') || 
    k.includes('profileSkills') || 
    k.includes('BE:authProfile')
  );
  
  console.log('Profile-related keys:', profileKeys);
});

// Check specific key format (should include userId)
AsyncStorage.getAllKeys().then(keys => {
  const editProfileKeys = keys.filter(k => k.includes('editProfile'));
  
  // EXPECTED: Keys like "editProfile:draft:uuid"
  // FAIL: Key like "editProfile:draft" (no uuid)
  
  console.log('Edit profile keys:', editProfileKeys);
});
```

### Expected Key Patterns:
✅ CORRECT:
```
editProfile:draft:00000000-0000-0000-0000-000000000001
profileSkills:00000000-0000-0000-0000-000000000001
BE:authProfile:00000000-0000-0000-0000-000000000001
```

❌ INCORRECT (Data Leak):
```
editProfile:draft
profileSkills
BE:authProfile
```

---

## Test 7: Profile Update Isolation (5 minutes)

### Steps:
1. **Login as User A**
   - Edit Profile → Change bio to "User A Updated Bio"
   - **Save Changes**
   - Logout

2. **Login as User B**
   - View Profile
   - **EXPECTED**: User B's bio unchanged
   - **FAIL**: If bio shows "User A Updated Bio"

### Result:
- [ ] PASS: User B's profile unaffected
- [ ] FAIL: User A's update affected User B

---

## Summary Checklist

After running all tests:

- [ ] Test 1: Draft Isolation - PASS
- [ ] Test 2: Skills Isolation - PASS
- [ ] Test 3: Cache Isolation - PASS
- [ ] Test 4: Logout Cleanup - PASS
- [ ] Test 5: Rapid Switching - PASS
- [ ] Test 6: Key Inspection - PASS
- [ ] Test 7: Update Isolation - PASS

**Overall Result**: _____ / 7 tests passed

---

## If Tests Fail

### Common Issues:

1. **Old cached keys remain**:
   - Solution: Clear app data completely
   - iOS: Delete app and reinstall
   - Android: Settings → Apps → BountyExpo → Clear Data

2. **Test users sharing ID**:
   - Solution: Ensure test users have different IDs in Supabase
   - Check: `console.log(session?.user?.id)` should differ

3. **Code not updated**:
   - Solution: Rebuild app (`npx expo start --clear`)
   - Ensure latest code is pulled

---

## Expected Behavior Summary

### ✅ SECURE (After Fix):
- Each user's draft stored separately
- Logout clears user-specific data
- Profile cache per user
- No data visible across user boundaries

### ❌ VULNERABLE (Before Fix):
- Single draft key shared by all users
- Logout doesn't clear data
- Cache shared across users
- Data leaks between sessions

---

## Reporting Results

If you find any failures:

1. Note which test failed
2. Record the exact behavior observed
3. Check console for errors
4. Inspect AsyncStorage keys
5. Report with:
   - Test number and name
   - Expected vs Actual behavior
   - AsyncStorage key patterns observed
   - Console logs (if any)

---

**Test Version**: 1.0.0
**Created**: 2025-10-15
**Related Fix**: Profile Data Isolation (PR #xxx)
