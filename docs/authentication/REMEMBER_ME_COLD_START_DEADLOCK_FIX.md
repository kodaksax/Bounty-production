# Remember Me Cold-Start Deadlock Fix - Technical Summary

## Issue Description
**Issue:** #624
**Symptom:** With "Remember Me" enabled, the app signs in correctly during a normal session. But after a **hard close** and relaunch, the app logs in yet the **bounty feed loads infinitely** (never resolves despite a working connection). A follow-up report added that returning users are sometimes **forced into the onboarding flow** instead of their account.
**Expected:** After a hard close, a "Remember Me" user should be restored straight into their account with a working feed.

## Root Cause

### Auth-lock reentrancy deadlock

`providers/auth-provider.tsx` registers a `supabase.auth.onAuthStateChange` handler. On React Native (non-browser) the Supabase client uses gotrue's default no-op lock, and the handler runs **synchronously inside** that auth lock (`_acquireLock`).

The handler previously `await`ed `authProfileService.setSession(session)` to hydrate the profile. `setSession()` issues `supabase.from('profiles').select(...)` queries, and **every** Supabase query internally calls `auth.getSession()`, which **re-acquires the same lock**.

```
onAuthStateChange fires  ── holds the auth lock ──┐
  await setSession()                              │
    supabase.from('profiles').select()           │
      auth.getSession()                           │
        _acquireLock()  ── waits for the lock ────┘  ← never releases:
                                                       the lock can't release until
                                                       the handler returns, but the
                                                       handler is awaiting the query
```

This is the exact *"do not `await` other Supabase methods inside `onAuthStateChange`"* hazard documented by Supabase.

### Why it only surfaced on cold start with "Remember Me"

On a cold start the restored session is typically **expired**, so `getSession()` refreshes it and fires `TOKEN_REFRESHED` **inside the lock**. That triggers the deadlock above. During a normal in-session sign-in the 8s `Promise.race` timeout partially masked the hang, but on cold start the feed's own queries fire during the deadlock window and hang too.

### Cascading symptoms

- The deadlocked profile query leaves the profile `null` → `app/tabs/bounty-app.tsx`'s onboarding gate can't verify the local "onboarding completed" flag → **forced onboarding redirect**.
- The deadlocked feed queries never resolve `isLoadingBounties` / `applicationsLoaded` → `components/bounty-feed.tsx` shows the skeleton **forever**.

## The Fix

Defer the profile-sync work out of the lock onto a macrotask (`setTimeout(..., 0)`) in the `onAuthStateChange` handler. Scheduling on a macrotask lets the current lock release **before** the profile queries run, so they no longer deadlock.

```ts
// providers/auth-provider.tsx — inside onAuthStateChange
setTimeout(() => {
  let sessionSyncTimeout: ReturnType<typeof setTimeout> | undefined
  ;(async () => {
    try {
      await Promise.race([
        authProfileService.setSession(session),
        new Promise<void>(resolve => { sessionSyncTimeout = setTimeout(resolve, 8_000) }),
      ])
      profileFetchCompletedRef.current = true
    } catch (e) {
      profileFetchCompletedRef.current = true
    } finally {
      if (sessionSyncTimeout) clearTimeout(sessionSyncTimeout)
      if (isMountedRef.current) setIsLoading(false)
    }
  })()
}, 0)
```

State that must stay in lock-step with the event (session update, `isLoading` re-arm, password-recovery, analytics) remains synchronous. The 8s timeout race and `profileFetchCompletedRef` semantics are preserved; only the *timing* (deferred, not inline) changed.

### Why the `fetchSession` path needed no change

The initial mount `fetchSession` `await`s `supabase.auth.getSession()` **first** (the lock releases when it resolves) and only then calls `authProfileService.setSession()` — already outside the lock.

## Verification

- Reproduced the deadlock with a runnable Supabase repro (a query inside `onAuthStateChange` never completed); the deferred version completed in a few ms.
- Added a regression test in `__tests__/integration/auth-persistence.test.tsx` (`defers profile sync off the auth lock to avoid deadlock`) asserting `authProfileService.setSession` is **not** invoked inline within the handler and only runs after the deferred macrotask fires.
- `npx tsc --noEmit` passes; auth-related jest suites pass; ESLint reports no new errors; CodeQL reports 0 alerts.

## Files Changed
- `providers/auth-provider.tsx` — defer profile sync + `setIsLoading(false)` off the auth lock.
- `__tests__/integration/auth-persistence.test.tsx` — regression test for the deferral.
