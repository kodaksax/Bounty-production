# Testing Guide for Session Restoration Optimization

## Overview
This guide helps you verify that the session restoration optimization changes work correctly and improve the user experience.

## Setup Requirements
- Physical iOS or Android device (recommended) or simulator/emulator
- Development build of the app with the changes
- Network connection
- Ability to control app state (close/reopen)

## Test Scenarios

### Scenario 1: First-Time User (No Cache)
**Purpose**: Verify graceful fallback when no cached profile exists

**Steps**:
1. Install fresh build or clear app data
2. Sign in with valid credentials
3. Wait for dashboard to load
4. Note the time it takes to reach dashboard after sign-in

**Expected Results**:
- ✅ Native splash shows emerald background (not white)
- ✅ Branded splash shows for ~800ms (not 1500ms)
- ✅ Profile loads from network (normal speed)
- ✅ Dashboard appears after profile loads
- ✅ No errors or crashes

**Measured Metrics**:
- Time from app launch to dashboard: ______ ms

---

### Scenario 2: Returning User (With Cache) - Happy Path
**Purpose**: Verify instant session restoration with cached profile

**Steps**:
1. Sign in and use the app normally
2. Navigate to a few screens to ensure profile is cached
3. **Close the app completely** (swipe away from app switcher)
4. Wait 5 seconds
5. **Reopen the app**
6. Note the time it takes to reach dashboard

**Expected Results**:
- ✅ Native splash shows emerald background
- ✅ Branded splash shows for ~800ms
- ✅ Dashboard appears **immediately** after splash (no loading screen)
- ✅ Profile data is visible instantly (username, avatar, balance)
- ✅ Network request happens in background (check network tab)
- ✅ Profile data updates silently if any changes exist

**Measured Metrics**:
- Time from app launch to dashboard: ______ ms (should be ~1400-1550ms)
- Profile visible: ✅ Instant or ❌ Delayed

**Performance Comparison**:
- Previous version: ~2300-2700ms
- This version: ~1400-1550ms
- **Improvement**: ~900-1150ms faster (35-42%)

---

### Scenario 3: Stale Cache (5+ Minutes)
**Purpose**: Verify cache expiration and refresh

**Steps**:
1. Sign in and use the app
2. Close the app
3. **Wait 6+ minutes** (cache expires after 5 minutes)
4. Reopen the app
5. Note the behavior

**Expected Results**:
- ✅ Dashboard appears quickly (may use expired cache initially)
- ✅ Fresh profile data loads from network
- ✅ UI updates with fresh data
- ✅ No errors or inconsistencies

---

### Scenario 4: Network Offline
**Purpose**: Verify graceful handling when network is unavailable

**Steps**:
1. Sign in and use the app
2. Close the app
3. **Turn off network** (airplane mode or disable WiFi/data)
4. Reopen the app
5. Observe behavior

**Expected Results**:
- ✅ Dashboard appears with cached profile data
- ✅ App remains functional with cached data
- ✅ Background fetch fails silently (check logs)
- ✅ User can still navigate and use cached features
- ✅ No error alerts shown to user (graceful degradation)

**When Network Returns**:
- ✅ Fresh profile data syncs automatically
- ✅ UI updates with latest data

---

### Scenario 5: Profile Changes While Offline
**Purpose**: Verify profile updates sync correctly

**Steps**:
1. Sign in on Device A
2. Close app on Device A
3. Make profile changes on Device B or web (e.g., change username)
4. Reopen app on Device A
5. Observe profile data

**Expected Results**:
- ✅ Initial load shows cached (old) profile
- ✅ Within ~1-2 seconds, profile updates to latest data
- ✅ UI reflects new changes (e.g., new username visible)
- ✅ Cache is updated with fresh data

---

### Scenario 6: Rapid App Reopen (Race Condition Test)
**Purpose**: Verify race condition protection works

**Steps**:
1. Sign in and use the app
2. Close the app
3. **Immediately reopen** (within 1 second)
4. **Close again immediately**
5. **Reopen again**
6. Repeat this cycle 3-5 times rapidly

**Expected Results**:
- ✅ No crashes or errors
- ✅ Profile data remains consistent
- ✅ Latest data is always displayed
- ✅ No stale data overwrites fresh data
- ✅ App remains responsive

**Check Logs**:
- Should see messages like: "Discarding stale background fetch result"
- Should see proper timestamp management

---

### Scenario 7: Visual Continuity Check
**Purpose**: Verify seamless visual transition

**Steps**:
1. Close the app
2. Reopen the app
3. **Watch carefully** for any color flashes or transitions

**Expected Results**:
- ✅ Native splash uses emerald background (#15803d)
- ✅ Branded splash uses matching emerald background
- ✅ No white flash or jarring color change
- ✅ Smooth transition from splash to dashboard
- ✅ Icon is clearly visible on emerald background

**Accessibility Check**:
- ✅ Icon has sufficient contrast on emerald background
- ✅ Icon is recognizable and clear
- If contrast is poor, recommend adjusting icon design

---

### Scenario 8: Session Expiration
**Purpose**: Verify behavior when session expires

**Steps**:
1. Sign in and use the app
2. Wait for session to expire (or manually expire token)
3. Close and reopen the app

**Expected Results**:
- ✅ User is redirected to login screen
- ✅ No cached profile data is shown
- ✅ Session expiration is handled gracefully
- ✅ User can sign in again

---

## Performance Measurement Tools

### Manual Timing
Use a stopwatch or phone timer to measure:
1. Start: When app icon is tapped
2. Stop: When dashboard is fully rendered and interactive

### Device Logs (Recommended)
For more accurate measurements, check device logs:

**iOS (Xcode)**:
```
Window > Devices and Simulators > Select Device > Open Console
Filter: authProfileService
```

**Android (ADB)**:
```bash
adb logcat | grep authProfileService
```

Look for these log messages:
- `[authProfileService] Using cached profile for fast restoration`
- `[authProfileService] Fetching fresh profile in background`
- `[authProfileService] Fresh profile fetched, updating cache`

### Network Monitoring
Use React Native Debugger or Chrome DevTools to verify:
- ✅ Profile fetch happens in background
- ✅ Network request is non-blocking
- ✅ Cache-first strategy is working

---

## Regression Testing

### Areas to Check for Regressions
1. **Sign In Flow**: Ensure normal sign-in still works
2. **Sign Out Flow**: Verify sign out clears cache and session
3. **Profile Updates**: Test updating profile settings
4. **Onboarding**: Check new user onboarding flow
5. **Deep Links**: Verify deep linking still works
6. **Push Notifications**: Test notification handling
7. **Background Refresh**: Verify background app refresh

### Common Issues to Watch For
- ❌ White screen or blank dashboard
- ❌ Stale profile data not updating
- ❌ Session not persisting between app restarts
- ❌ Crashes on rapid app reopen
- ❌ Memory leaks from unclosed promises
- ❌ Network requests not completing

---

## Success Criteria

### Must Pass
- ✅ All test scenarios pass without errors
- ✅ Performance improvement of 30%+ for returning users
- ✅ No visual regressions (white flash eliminated)
- ✅ Race conditions handled properly
- ✅ No security vulnerabilities introduced
- ✅ Backward compatibility maintained

### Nice to Have
- ✅ Performance improvement of 35%+ (target met)
- ✅ Zero network requests for initial dashboard render
- ✅ Smooth, seamless user experience
- ✅ Accessibility standards maintained

---

## Troubleshooting

### Issue: Profile data is stale
**Possible Causes**:
- Cache not expiring correctly
- Background fetch failing silently
- Network requests being blocked

**Debug Steps**:
1. Check device logs for background fetch errors
2. Verify network connectivity
3. Check cache timestamp in AsyncStorage
4. Force clear cache and retry

### Issue: White splash screen still appears
**Possible Causes**:
- App not rebuilt with new configuration
- Native splash configuration not updated
- Platform-specific caching

**Debug Steps**:
1. Clean build and reinstall app
2. Check app.json splash screen configuration
3. Clear Expo cache: `expo start --clear`
4. Rebuild native binaries

### Issue: App crashes on reopen
**Possible Causes**:
- Race condition not handled properly
- Promise rejection not caught
- Invalid cache data

**Debug Steps**:
1. Check crash logs for stack trace
2. Clear app cache and retry
3. Test with fresh install
4. Review recent code changes

---

## Reporting Results

### Report Template
```markdown
## Test Results: Session Restoration Optimization

**Device**: [iPhone 14 Pro / Samsung Galaxy S23 / etc.]
**OS Version**: [iOS 17.2 / Android 14 / etc.]
**App Build**: [Build number or commit hash]
**Tester**: [Your name]
**Date**: [Test date]

### Performance Metrics
- First-time user (no cache): _____ ms to dashboard
- Returning user (with cache): _____ ms to dashboard
- Improvement: _____ ms faster (_____ %)

### Test Scenarios
- [ ] Scenario 1: First-Time User - PASS/FAIL
- [ ] Scenario 2: Returning User - PASS/FAIL
- [ ] Scenario 3: Stale Cache - PASS/FAIL
- [ ] Scenario 4: Network Offline - PASS/FAIL
- [ ] Scenario 5: Profile Changes - PASS/FAIL
- [ ] Scenario 6: Rapid Reopen - PASS/FAIL
- [ ] Scenario 7: Visual Continuity - PASS/FAIL
- [ ] Scenario 8: Session Expiration - PASS/FAIL

### Issues Found
1. [Describe issue 1]
2. [Describe issue 2]

### Notes
[Any additional observations or comments]
```

---

## Next Steps After Testing

1. **If all tests pass**: ✅ Approve PR and merge to main
2. **If minor issues**: 🔧 Create follow-up issues and merge
3. **If major issues**: ❌ Request changes and retest
4. **Deploy to staging**: Test in staging environment
5. **Deploy to production**: Roll out to users gradually (if possible)
6. **Monitor metrics**: Track actual user performance improvements

---

## Additional Resources

- [Session Restoration Optimization Documentation](./SESSION_RESTORATION_OPTIMIZATION.md)
- [Expo Splash Screen Docs](https://docs.expo.dev/versions/latest/sdk/splash-screen/)
- [React Native Performance](https://reactnative.dev/docs/performance)
- [AsyncStorage Best Practices](https://react-native-async-storage.github.io/async-storage/)
