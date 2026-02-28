# Dev Client (EAS) — Build & Install

This repo is configured to produce an Expo development client (dev-client) which includes the native bits required for Hermes, HMR, and React Native DevTools.

Prerequisites
- Node 18+
- Android SDK (for `expo run:android`) or an Expo account and `eas-cli` for EAS builds
- `eas-cli`: `npm install -g eas-cli`
- Login to EAS: `eas login`

Options

A) Quick local dev-client (recommended for Android with SDK set up)

1. Start Metro in dev-client mode (clears cache):

```bash
npx expo start --dev-client -c
```

2. Build and install a local dev-client APK (requires Android SDK/emulator/device):

```bash
# This compiles a dev client and installs onto a connected device/emulator
npx expo run:android
```

3. Open the installed dev client app on your device and scan the Metro QR or select the running packager.

B) EAS development build (recommended for real devices / iOS)

1. Ensure `eas.json` has a `development` profile (this repo already includes one).
2. Build a dev client (Android example):

```bash
# Triggers a cloud dev build
eas build --profile development -p android
```

3. After the build completes, install the APK via the EAS web installer (QR) or download and install via `adb`:

```bash
adb install -r <path-to-downloaded-apk>
```

Verification
- After installing a dev-client built with the `development` profile, open it and connect to the Metro packager.
- React Native DevTools and Hermes-based tooling should be available and the earlier HMRClient errors should be resolved.

Notes
- If you use `expo run:android`, Android Studio / SDK must be configured and `adb` available in PATH.
- On iOS, you must build with EAS or run on macOS with `npx expo run:ios`.
- If you still see "registered callable JavaScript modules (n = 0)", ensure you are running a dev-client build (not stock Expo Go). The native bridge in stock Expo Go may not accept callable registrations expected by this project.

Troubleshooting
- If EAS build fails, run `eas build --clear-cache` and re-try, or paste the EAS build logs here for help.
- If native HMR errors persist after installing a dev-client build, paste the Metro and device logs.
