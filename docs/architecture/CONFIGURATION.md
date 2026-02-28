iOS Google Maps key and EAS build configuration

- Purpose: document where to set the iOS Google Maps API key used during EAS builds.

1) Environment variable name
- Set `EXPO_GOOGLE_MAPS_IOS_KEY` for iOS builds. This value will be injected into `app.json` when building with EAS if you use the `${EXPO_GOOGLE_MAPS_IOS_KEY}` placeholder.

2) EAS (recommended)
- Create a secret in EAS for secure storage:

```bash
eas secret:create --name EXPO_GOOGLE_MAPS_IOS_KEY --value "<YOUR_IOS_GOOGLE_MAPS_KEY>"
```

- Ensure your build profile uses the secret or that the secret is available in the project via EAS CLI.

3) Local / CI
- Locally, export the env var before running builds:

```bash
export EXPO_GOOGLE_MAPS_IOS_KEY="AIza..."
```

- On Windows (PowerShell):

```powershell
$env:EXPO_GOOGLE_MAPS_IOS_KEY = "AIza..."
```

4) app.json configuration
- `app.json` should reference the env var:

```json
"config": {
  "googleMapsApiKey": "${EXPO_GOOGLE_MAPS_IOS_KEY}"
}
```

5) Notes & Apple review
- If your app requests background location (`NSLocationAlwaysAndWhenInUseUsageDescription` and `UIBackgroundModes: ["location"]`), only request Always permission when your feature requires it. Apple reviews background-location usage closely; provide clear justification in App Store metadata and App Review notes.

6) Troubleshooting
- If builds fail due to a missing key, ensure the EAS secret exists and the env var is present in your build environment.
- For local prebuild steps, run `npx eas build:configure` and verify `expo prebuild` output includes the configured key.
