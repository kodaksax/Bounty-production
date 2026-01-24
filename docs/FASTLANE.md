Fastlane + EAS integration

This project uses Fastlane lanes that shell out to the EAS CLI to perform builds and submission. This keeps the build artifacts and submission coordinated with EAS while letting CI orchestrate the end-to-end flow via Fastlane.

Required secrets (GitHub Actions):
- `EXPO_TOKEN` — an EAS CLI token (recommended)
- `PLAY_SERVICE_ACCOUNT_JSON` — base64 or raw JSON contents of Google Play service account (Android submission)
- `APPLE_ID` — Apple ID email (for info; not a secret)
- `ASC_APP_ID` — App Store Connect app ID
- `APPLE_TEAM_ID` — Apple team ID

Local usage (macOS / Linux / Windows with WSL):
1. Install Node.js and EAS CLI:

```bash
npm install -g eas-cli
```

2. Install Ruby and bundler (for Fastlane):

macOS (Homebrew):

```bash
brew install ruby
gem install bundler
bundle install
```

3. To run the Android lane locally (make sure `PLAY_SERVICE_ACCOUNT_JSON` is available):

```bash
# write your service account JSON to /tmp/play-service-account.json
export PLAY_SERVICE_ACCOUNT_JSON=$(cat my-play-service-account.json)
echo "$PLAY_SERVICE_ACCOUNT_JSON" > /tmp/play-service-account.json
bundle exec fastlane build_and_submit_android
```

4. To run the iOS lane locally (requires access to Apple credentials, and macOS recommended):

```bash
export EXPO_TOKEN=your_eas_token
export APPLE_ID=you@apple.com
export ASC_APP_ID=123456789
export APPLE_TEAM_ID=XXXXXXXXX
bundle exec fastlane build_and_submit_ios
```

Notes:
- CI workflow is at `.github/workflows/fastlane-eas.yml` and is configured to run `fastlane` which calls `eas build` and `eas submit`.
- Do NOT store secrets in the repo; add them to GitHub Actions Secrets.
- You can customize the `eas` profile names used in the Fastfile if your `eas.json` uses different profiles.
