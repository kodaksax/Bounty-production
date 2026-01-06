# Metro Config Fix - Expo Web Export Serialization

## Issue
The CI build was failing during the Expo web export step with the following error:
```
Error: Serializer did not return expected format. The project copy of `expo/metro-config` may be out of date.
```

## Root Cause
The project was using `@react-native/metro-config` instead of `expo/metro-config` in `metro.config.js`. The `@react-native/metro-config` is designed for bare React Native projects, not Expo projects with:
- expo-router
- Static web rendering enabled
- Metro bundler for web output

## Solution
Updated `metro.config.js` to use Expo's Metro configuration:

### Before
```javascript
const { getDefaultConfig } = require('@react-native/metro-config');
const defaultConfig = getDefaultConfig(__dirname);
```

### After
```javascript
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
```

## Why This Works
- Expo's Metro config includes the correct serializer for static rendering and web exports
- It properly handles expo-router's file-based routing system
- It supports Expo's web output format specified in `app.json`

## Files Modified
- `metro.config.js` - Updated to use `expo/metro-config`

## Files Already Using Correct Config
- `metro.config.cjs` - Already using `expo/metro-config` correctly

## Verification
After this fix:
1. Metro bundler successfully serializes code (reaches 99.9% completion)
2. The "Serializer did not return expected format" error is resolved
3. CI build progresses past the Metro serialization stage

## Related Configuration
- `app.json` specifies: `"web": { "bundler": "metro", "output": "static" }`
- Project uses `expo-router` with typed routes
- Both metro config files (.js and .cjs) now use `expo/metro-config`
