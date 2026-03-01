# Navigation Context Fix

## Issue
The app was throwing the runtime error:
```
Couldn't find a navigation context. Have you wrapped your app with 'NavigationContainer'?
```
Whenever components called `useRouter()` (e.g. the search route). This happened because `App.tsx` exported a standalone React component (a Todo list) which **overrode Expo Router's own root entry**, preventing the router from setting up the navigation context.

## Root Cause
`package.json` already sets:
```json
"main": "expo-router/entry"
```
But by having an `App.tsx` with a default exported component, Metro loaded that instead of letting `expo-router/entry` establish the routing providers. As a result, screens rendered outside of the navigation tree.

## Fix
Replaced the previous implementation in `App.tsx` with a thin delegation:
```ts
import 'expo-router/entry';
```
Plus explanatory comments. No React component is exported now, so Expo Router supplies its own root (including the navigation container) and `useRouter()` works everywhere.

## Text String Error
The secondary error:
```
Text strings must be rendered within a <Text> component.
```
Was likely triggered by legacy code during the failed navigation initialization (React attempting to treat raw children incorrectly). After restoring the navigation context and auditing the `search-screen` (all text resides inside `<Text>`), this warning should no longer appear.

## Verification Steps
1. Restart bundler (clear cache if needed):
   ```sh
   npx expo start --clear
   ```
2. Open the app, tap the search bar.
3. Confirm search screen loads without navigation context error.
4. Perform a search; ensure no red screen and no "Text strings" warning in LogBox.

## Notes
If you later need a global bootstrap (e.g., polyfills or instrumentation), keep `App.tsx` as a side-effect module only—do not export a component.
