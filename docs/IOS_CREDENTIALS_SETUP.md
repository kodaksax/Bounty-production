# iOS Credentials Setup Guide

This guide covers setting up iOS credentials for the BOUNTYExpo app. You'll need these credentials for building and distributing the app through Expo Application Services (EAS).

## Prerequisites

- An Apple Developer Account (Individual or Organization)
- [EAS CLI](https://docs.expo.dev/eas/) installed: `npm install -g eas-cli`
- Logged into EAS: `eas login`
- Logged into Expo: `npx expo login`

## Current App Configuration

The app uses the following identifiers (defined in `app.json`):

- **Bundle Identifier**: `com.bounty0.BOUNTYExpo`
- **EAS Project ID**: `b5485f88-0b1f-4622-bbed-b1ae142dcb46`
- **Slug**: `BOUNTYExpo`

---

## 1. Bundle Identifier

The bundle identifier uniquely identifies your app in the Apple ecosystem. It must be unique across all apps on the App Store.

### Current Configuration

```json
// app.json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "com.bounty0.BOUNTYExpo"
    }
  }
}
```

### Setting Up a New Bundle Identifier

1. **Register the Bundle ID in Apple Developer Portal**:
   - Go to [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list)
   - Click the **+** button to create a new identifier
   - Select **App IDs** → **Continue**
   - Select **App** → **Continue**
   - Fill in:
     - **Description**: Your app name (e.g., "BOUNTYExpo")
     - **Bundle ID**: Choose **Explicit** and enter your bundle identifier (e.g., `com.yourcompany.bountyexpo`)
   - Enable required **Capabilities** (see section below)
   - Click **Continue** → **Register**

2. **Update app.json**:
   ```json
   {
     "expo": {
       "ios": {
         "bundleIdentifier": "com.yourcompany.bountyexpo"
       }
     }
   }
   ```

3. **Clear existing credentials** (if changing bundle ID):
   ```bash
   eas credentials --platform ios
   # Select "Remove a provisioning profile" or "Remove a distribution certificate"
   ```

### Required Capabilities for BOUNTYExpo

When registering your Bundle ID, enable these capabilities:

- **Push Notifications** - For chat and status notifications
- **Associated Domains** - For deep linking (if using universal links)
- **Apple Pay** - For payment processing (merchant identifier: `merchant.com.bountyexpo-workspace`)
- **Sign In with Apple** - If implementing Apple Sign-In

---

## 2. Distribution Type

EAS Build supports different distribution types depending on your use case.

### Development Build

For development and testing with Expo dev client:

```json
// eas.json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    }
  }
}
```

**Use case**: Local development, debugging, testing new native modules.

### Preview/Internal Distribution (Ad Hoc)

For sharing test builds with a limited group of registered devices:

```json
// eas.json
{
  "build": {
    "preview": {
      "distribution": "internal"
    }
  }
}
```

**Use case**: Beta testing, QA, stakeholder review.

**Requirements**:
- Devices must be registered in Apple Developer Portal
- Maximum 100 devices per device type per year

### App Store Distribution

For TestFlight and App Store releases:

```json
// eas.json
{
  "build": {
    "production": {
      "distribution": "store",
      "autoIncrement": true
    }
  }
}
```

**Use case**: TestFlight beta testing, App Store submission.

---

## 3. Distribution Certificate

The distribution certificate signs your app and verifies you as the developer.

### Types of Certificates

| Certificate Type | Purpose | Build Type |
|-----------------|---------|------------|
| Apple Development | Development builds | `development` |
| Apple Distribution | App Store & Ad Hoc | `preview`, `production` |

### Setting Up with EAS (Recommended)

EAS can automatically manage certificates for you:

```bash
# Let EAS create and manage certificates
eas build:configure

# Build and let EAS handle credentials
eas build --platform ios --profile production
```

When prompted:
- Select **"Generate new Apple Distribution certificate"** (or use existing)
- EAS will create and store the certificate securely

### Manual Certificate Setup

If you need to manage certificates manually:

1. **Generate a Certificate Signing Request (CSR)**:
   ```bash
   # On macOS Keychain Access:
   # Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority
   # Save to disk as "CertificateSigningRequest.certSigningRequest"
   ```

2. **Create Certificate in Apple Developer Portal**:
   - Go to [Certificates](https://developer.apple.com/account/resources/certificates/list)
   - Click **+** to create a new certificate
   - Select **Apple Distribution** (for App Store/Ad Hoc)
   - Upload your CSR file
   - Download the `.cer` file

3. **Export as .p12**:
   - Double-click the `.cer` file to add to Keychain
   - In Keychain Access, find the certificate
   - Right-click → **Export** → Save as `.p12` with a password

4. **Upload to EAS**:
   ```bash
   eas credentials --platform ios
   # Select "Add a distribution certificate"
   # Choose "Upload a certificate (.p12 file)"
   ```

### Certificate Limits

- **Apple Distribution**: 3 certificates per account
- **Apple Development**: 2 certificates per account

To check existing certificates:
```bash
eas credentials --platform ios
# Select "Show all distribution certificates"
```

---

## 4. Provisioning Profile

Provisioning profiles link your app, certificates, and (for Ad Hoc) device UDIDs.

### Types of Provisioning Profiles

| Profile Type | Distribution | Use Case |
|--------------|--------------|----------|
| iOS App Development | `internal` | Development builds |
| Ad Hoc | `internal` | Testing on registered devices |
| App Store | `store` | TestFlight & App Store |

### Automatic Management with EAS

EAS automatically creates and manages provisioning profiles:

```bash
# Build with automatic profile management
eas build --platform ios --profile production

# EAS will:
# 1. Create/update the provisioning profile
# 2. Include any registered devices (for internal distribution)
# 3. Sign the build with the appropriate certificate
```

### Manual Profile Setup

1. **Create Profile in Apple Developer Portal**:
   - Go to [Profiles](https://developer.apple.com/account/resources/profiles/list)
   - Click **+** to create a new profile
   - Select profile type based on distribution
   - Select your App ID (bundle identifier)
   - Select your distribution certificate
   - For Ad Hoc: Select registered devices
   - Download the `.mobileprovision` file

2. **Upload to EAS**:
   ```bash
   eas credentials --platform ios
   # Select "Add a provisioning profile"
   # Choose "Upload a provisioning profile"
   ```

### Registering Devices for Ad Hoc Distribution

For internal/preview builds, register test devices:

```bash
# Register a single device
eas device:create

# Register multiple devices via URL
eas device:create --url
# Share the generated URL with testers
```

Alternatively, register manually in Apple Developer Portal:
- Go to [Devices](https://developer.apple.com/account/resources/devices/list)
- Click **+** → Enter device UDID and name

---

## 5. Push Notification Key (APNs Key) - Optional

Required if your app uses push notifications.

### Creating an APNs Key

1. **Generate Key in Apple Developer Portal**:
   - Go to [Keys](https://developer.apple.com/account/resources/authkeys/list)
   - Click **+** to create a new key
   - Name: `BOUNTYExpo Push Key`
   - Enable **Apple Push Notifications service (APNs)**
   - Click **Continue** → **Register**
   - **Download the `.p8` file** (only available once!)
   - Note the **Key ID**

2. **Note Your Team ID**:
   - Found in [Apple Developer Account](https://developer.apple.com/account) → Membership → Team ID

3. **Upload to EAS**:
   ```bash
   eas credentials --platform ios
   # Select "Add a push key"
   # Enter Key ID and upload the .p8 file
   ```

### APNs Key Information to Store

| Field | Value | Description |
|-------|-------|-------------|
| Key ID | 10-character string | Unique identifier for the key |
| Team ID | 10-character string | Your Apple Developer Team ID |
| Key File | `.p8` file | The authentication key (keep secure!) |

### Key Limits

- **Maximum 2 keys** per Apple Developer account
- One key can be used across multiple apps

---

## 6. App Store Connect API Key - Optional

Required for automated app submissions with `eas submit`.

### Creating an App Store Connect API Key

1. **Create Key in App Store Connect**:
   - Go to [App Store Connect](https://appstoreconnect.apple.com)
   - Navigate to **Users and Access** → **Integrations** → **App Store Connect API**
   - Click **+** to generate a new key
   - Name: `BOUNTYExpo EAS Submit`
   - Access: **Admin** or **App Manager**
   - Click **Generate**
   - **Download the `.p8` file** (only available once!)
   - Note the **Key ID** and **Issuer ID**

2. **Upload to EAS**:
   ```bash
   eas credentials --platform ios
   # Select "Add an App Store Connect API Key"
   # Enter Issuer ID, Key ID, and upload the .p8 file
   ```

### API Key Information to Store

| Field | Value | Description |
|-------|-------|-------------|
| Issuer ID | UUID format | Found in App Store Connect API page header |
| Key ID | 10-character string | Unique identifier for the key |
| Key File | `.p8` file | The API key (keep secure!) |

### Configure EAS Submit

Update `eas.json` for automated submissions:

```json
{
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "1234567890",
        "appleTeamId": "XXXXXXXXXX"
      }
    }
  }
}
```

Where:
- `appleId`: Your Apple ID email
- `ascAppId`: Your app's App Store Connect ID (found in App Store Connect → App Information)
- `appleTeamId`: Your Apple Developer Team ID

---

## Quick Reference Commands

### View Current Credentials

```bash
# Interactive credentials manager
eas credentials --platform ios

# List all credentials
eas credentials --platform ios --non-interactive
```

### Build Commands

```bash
# Development build
eas build --platform ios --profile development

# Preview/internal build (Ad Hoc)
eas build --platform ios --profile preview

# Production build (App Store)
eas build --platform ios --profile production
```

### Submit to App Store

```bash
# Submit latest build
eas submit --platform ios

# Submit specific build
eas submit --platform ios --id <build-id>
```

---

## Credential Storage Security

### EAS Managed Credentials

EAS securely stores credentials in Expo's infrastructure:
- Encrypted at rest and in transit
- Never exposed in build logs
- Access controlled by your Expo account

### Local Backup (Recommended)

Keep secure backups of:
- Distribution certificate `.p12` file and password
- APNs key `.p8` file
- App Store Connect API key `.p8` file

Store in a secure password manager or encrypted vault.

---

## Troubleshooting

### "No matching provisioning profiles found"

```bash
# Regenerate provisioning profile
eas credentials --platform ios
# Select "Remove a provisioning profile"
# Then rebuild - EAS will create a new one
```

### "Certificate has expired"

```bash
# Remove old certificate and create new one
eas credentials --platform ios
# Select "Remove a distribution certificate"
# Then rebuild - EAS will prompt for new certificate
```

### "Device not registered"

For internal/preview builds:
```bash
# Add the device
eas device:create

# Rebuild to update provisioning profile
eas build --platform ios --profile preview
```

### "Bundle identifier mismatch"

Ensure `app.json` bundle identifier matches:
1. The registered App ID in Apple Developer Portal
2. The provisioning profile's App ID

---

## Additional Resources

- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Credentials Documentation](https://docs.expo.dev/app-signing/managed-credentials/)
- [Apple Developer Program](https://developer.apple.com/programs/)
- [App Store Connect Help](https://developer.apple.com/help/app-store-connect/)

---

## Summary Checklist

Use this checklist when setting up credentials for a new bundle identifier:

- [ ] **Bundle Identifier**: Register in Apple Developer Portal and update `app.json`
- [ ] **Distribution Type**: Configure appropriate `eas.json` profile (`internal` or `store`)
- [ ] **Distribution Certificate**: Let EAS manage or upload manually via `eas credentials`
- [ ] **Provisioning Profile**: Created automatically by EAS during build
- [ ] **Push Key** (optional): Create APNs key if using push notifications
- [ ] **App Store Connect API Key** (optional): Create if using `eas submit`
