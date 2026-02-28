# Search Feature Testing Guide

## Purpose
Validate the end-to-end functionality of the new debounced Supabase/API backed bounty search screen.

## Preconditions
- App launched via Expo (simulator or physical device on same LAN as backend).
- Supabase env vars configured (EXPO_PUBLIC_SUPABASE_URL / KEY) OR API relay available.
- At least a few open bounties exist (create some with distinct titles/descriptions if needed).

## Scenarios

### 1. Open Search Screen
1. From Bounty dashboard tap the search bar.
2. Expect navigation to `/tabs/search` without errors.
3. Search input auto-focused and keyboard visible.

### 2. Initial Preload
1. Without typing, verify no runtime red screen.
2. If network offline: “No bounties loaded” card with Retry.
3. Toggle network, press Retry -> list state updates (card disappears when bounties load).

### 3. Debounced Remote Search
1. Type a query matching existing bounty title fragment (e.g., first 3 letters).
2. Loading state: spinner + “Searching…” appears briefly.
3. Results render with highlighted matches.
4. Clear button (x) appears; tap to clear -> results section collapses to recent searches.

### 4. No Results State
1. Enter a random string (e.g., `zzqqlmnop`).
2. After debounce, expect “No Results Found”.
3. Backspace to a valid term -> results repopulate.

### 5. Recent Searches Management
1. Execute 3 distinct searches.
2. Recent searches list shows them (newest first, capped at 5 total).
3. Tap a recent search -> instantly re-runs (spinner may flash) & moves (if duplicate was not already at top).
4. Remove a single item via its close icon (does not open full item).
5. Tap Clear all -> list removed.

### 6. Retry After Failure
1. Simulate failure (disconnect network or stop API) then search a term.
2. Expect Search failed UI with Retry button.
3. Restore network, tap Retry -> results return.

### 7. Back Navigation
1. Tap back arrow -> returns to dashboard; bounties list intact.
2. Re-open search -> previous query cleared (fresh state) except recent searches persist in-memory (session only).

### 8. Performance
1. Type rapidly (10+ chars quickly) -> only final query executes (debounce 250ms). No queue backlog.

## Edge Cases
- Empty string: no search executed, recent + suggested shown.
- Whitespace-only input: trimmed and treated as empty.
- Long query (>100 chars): still executes; ensure no crash.
- Mixed case query: matches case-insensitively.

## Expected Highlight Behavior
- Exact substring match segments wrapped with subtle yellow highlight.
- Non-matching segments remain default text color.

## Troubleshooting Hints
| Symptom | Possible Cause | Action |
| ------- | -------------- | ------ |
| Always empty results though data exists | RLS blocking anon read | Check Supabase policies for `bounties` select. |
| Network error hints about LAN | Physical device cannot reach dev machine | Replace localhost in EXPO_PUBLIC_API_BASE_URL with LAN IP, restart Expo. |
| Debounce not working (too many requests) | Local edit of debounce timing | Confirm debounceRef logic and 250ms value. |
| Highlight breaks text | Regex escaping issue | Ensure special chars escaped (already implemented). |

## Manual Verification Completion
Mark the feature verified when all scenarios pass without red screen errors or unhandled promise rejections.
