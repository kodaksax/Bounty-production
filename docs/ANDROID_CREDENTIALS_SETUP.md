# Android Credentials Setup Guide

This guide explains how to configure credentials for building and publishing the BOUNTY Android application. Whether you're setting up a new app identifier or preparing for Google Play Store submission, follow these steps.

## Table of Contents

1. [Application Identifier](#application-identifier)
2. [Android Upload Keystore](#android-upload-keystore)
3. [Google Service Account Key (Optional)](#google-service-account-key-optional)
4. [EAS Build Configuration](#eas-build-configuration)
5. [Troubleshooting](#troubleshooting)

---

## Application Identifier

The **Application Identifier** (also called Package Name) uniquely identifies your Android app on the Google Play Store. It follows the reverse domain name convention.

### Current Configuration

The BOUNTY app currently has the Android package name configured automatically by Expo based on the slug. To explicitly set it, add a `package` field to your `app.json`:

```json
{
  "expo": {
    "android": {
      "package": "com.bounty0.BOUNTYExpo"
    }
  }
}
```

> **Note:** If no explicit `package` is set, EAS Build will prompt you to enter one during your first build.

### Setting Up a New Application Identifier

1. **Choose a unique package name** following the convention:
   ```
   com.<company>.<appname>
   ```
   Example: `com.yourcompany.bountyexpo`

2. **Update `app.json`**:
   ```json
   {
     "expo": {
       "android": {
         "package": "com.yourcompany.bountyexpo",
         "adaptiveIcon": {
           "foregroundImage": "./assets/images/bounty-icon.png",
           "backgroundColor": "#ffffff"
         },
         "edgeToEdgeEnabled": true
       }
     }
   }
   ```

3. **Register on Google Play Console**:
   - Go to [Google Play Console](https://play.google.com/console/)
   - Create a new app and enter your package name
   - Once registered, the package name **cannot be changed**

### Best Practices

- Use the format `com.<company>.<appname>` with dots (`.`) separating segments
- Each segment should contain only lowercase letters, numbers, and underscores
- Package name must have at least one dot (e.g., `com.example`)
- Match your domain (if you own `bounty.app`, use `app.bounty.*`)
- Keep it short but descriptive
- Never include sensitive information

---

## Android Upload Keystore

The **Upload Keystore** is used to sign your Android app bundle (AAB) or APK before uploading to Google Play. Google Play requires all apps to be signed.

### Option 1: Let EAS Manage Credentials (Recommended)

Expo Application Services (EAS) can automatically generate and manage your keystore:

```bash
# Build and let EAS generate credentials automatically
eas build --platform android

# EAS will prompt you:
# ? Generate a new Android Keystore? (Y/n)
# Select 'Yes' for automatic generation
```

EAS stores your keystore securely in the cloud and uses it for all subsequent builds.

### Option 2: Use Your Own Keystore

If you need to use an existing keystore or manage it yourself:

#### Generate a New Keystore

```bash
# Generate a new upload keystore
keytool -genkeypair \
  -v \
  -storetype PKCS12 \
  -keystore upload-keystore.jks \
  -alias upload-key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# You'll be prompted for:
# - Keystore password (save this securely!)
# - Key password (can be the same as keystore password)
# - Your name, organization, location details
```

#### Configure EAS to Use Your Keystore

1. **Create a credentials configuration file** (`credentials.json`):
   ```json
   {
     "android": {
       "keystore": {
         "keystorePath": "./upload-keystore.jks",
         "keystorePassword": "YOUR_KEYSTORE_PASSWORD",
         "keyAlias": "upload-key",
         "keyPassword": "YOUR_KEY_PASSWORD"
       }
     }
   }
   ```

2. **Upload to EAS**:
   ```bash
   eas credentials
   # Select: Android
   # Select: Keystore
   # Select: Upload a keystore
   # Follow the prompts
   ```

3. **Delete local credentials file** after upload:
   ```bash
   rm credentials.json
   # NEVER commit credentials.json to git!
   ```

### Keystore Security Best Practices

⚠️ **Critical**: Your keystore is irreplaceable. If lost, you cannot update your app.

- **Back up securely**: Store encrypted copies in multiple secure locations
- **Use strong passwords**: Minimum 16 characters, mix of letters, numbers, symbols
- **Never commit to git**: Add to `.gitignore`:
  ```
  *.jks
  *.keystore
  credentials.json
  ```
- **Document recovery**: Store recovery information in a secure password manager
- **Consider EAS**: Let EAS manage keystores to reduce risk

### Viewing Keystore Information

```bash
# View keystore details
keytool -list -v -keystore upload-keystore.jks

# Get the SHA-256 fingerprint (needed for some APIs)
keytool -list -v -keystore upload-keystore.jks | grep SHA256
```

---

## Google Service Account Key (Optional)

A **Google Service Account Key** enables automated publishing to Google Play Store. This is optional but recommended for CI/CD pipelines.

### When You Need This

- Automated builds publishing directly to Google Play
- EAS Submit for automatic store uploads
- CI/CD pipelines (GitHub Actions, etc.)

### Step-by-Step Setup

#### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your project ID

#### 2. Enable the Google Play Android Developer API

1. In Google Cloud Console, go to **APIs & Services > Library**
2. Search for "Google Play Android Developer API"
3. Click **Enable**

#### 3. Create a Service Account

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > Service Account**
3. Fill in the details:
   - **Name**: `bounty-play-publisher`
   - **Description**: Service account for automated Play Store publishing
4. Click **Create and Continue**
5. Skip role assignment (we'll grant access in Play Console instead)
6. Click **Done**

#### 4. Generate a JSON Key

1. Find your new service account in the credentials list
2. Click on the service account email
3. Go to **Keys** tab
4. Click **Add Key > Create new key**
5. Select **JSON** format
6. Click **Create**
7. Save the downloaded JSON file securely

#### 5. Grant Access in Google Play Console

1. Go to [Google Play Console](https://play.google.com/console/)
2. Navigate to **Users and permissions**
3. Click **Invite new users**
4. Enter the service account email (found in the JSON file)
5. Set permissions:
   - **App access**: Select your app(s)
   - **Account permissions**: None needed
   - **App permissions**:
     - ✅ Release to production, exclude devices, and use Play App Signing
     - ✅ Release apps to testing tracks
     - ✅ Manage testing tracks and edit tester lists
6. Click **Invite user**
7. Accept the invitation (may happen automatically)

#### 6. Configure EAS Submit

Add to your `eas.json`:

```json
{
  "cli": {
    "version": ">= 16.19.3",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "internal"
      }
    }
  }
}
```

#### 7. Upload Service Account Key to EAS

For security, upload the key to EAS instead of storing locally:

```bash
# Upload the service account key
eas credentials
# Select: Android
# Select: Google Service Account Key
# Select: Upload a Google Service Account Key
# Provide the path to your JSON file
```

Then update `eas.json` to use the uploaded key:

```json
{
  "submit": {
    "production": {
      "android": {
        "track": "internal"
      }
    }
  }
}
```

### Publishing Workflow

With everything configured:

```bash
# Build for production
eas build --platform android --profile production

# Submit to Google Play (internal testing track)
eas submit --platform android --profile production

# Or build and submit in one command
eas build --platform android --profile production --auto-submit
```

### Track Options

Configure the `track` in `eas.json`:

| Track | Description |
|-------|-------------|
| `internal` | Internal testing (limited testers) |
| `alpha` | Closed testing |
| `beta` | Open testing |
| `production` | Full production release |

---

## EAS Build Configuration

Here's a complete `eas.json` configuration for BOUNTY:

```json
{
  "cli": {
    "version": ">= 16.19.3",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "autoIncrement": true,
      "android": {
        "buildType": "app-bundle"
      }
    }
  },
  "submit": {
    "production": {
      "android": {
        "track": "internal"
      }
    }
  }
}
```

### Build Commands Quick Reference

```bash
# Development build (APK for testing)
eas build --platform android --profile development

# Preview build (APK for internal distribution)
eas build --platform android --profile preview

# Production build (AAB for Play Store)
eas build --platform android --profile production

# Submit to Play Store
eas submit --platform android

# Check build status
eas build:list

# View credentials
eas credentials
```

---

## Troubleshooting

### Common Issues

#### "Keystore was tampered with, or password was incorrect"

- Double-check your keystore password
- Ensure you're using the correct keystore file
- Try regenerating the keystore if issues persist

#### "Package name already exists on Google Play"

- Package names are globally unique
- Choose a different package name
- Or claim ownership if it's your existing app

#### "Service account doesn't have permission"

1. Verify the service account email in Play Console
2. Check that app-level permissions are granted
3. Wait 24 hours for permission propagation
4. Ensure the Google Play Android Developer API is enabled

#### "Build failed: Signing configuration not found"

```bash
# Reset EAS credentials
eas credentials --platform android

# Select: Remove a keystore
# Then rebuild with automatic credential generation
eas build --platform android
```

#### "Version code has already been used"

- EAS increments version codes automatically with `autoIncrement: true`
- If manual, increase `versionCode` in `app.json`:
  ```json
  {
    "expo": {
      "android": {
        "versionCode": 2
      }
    }
  }
  ```

### Getting Help

- [Expo EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [Google Play Console Help](https://support.google.com/googleplay/android-developer/)
- [Android App Signing](https://developer.android.com/studio/publish/app-signing)

---

## Security Checklist

Before going to production, verify:

- [ ] Keystore is backed up in multiple secure locations
- [ ] Keystore passwords are stored in a password manager
- [ ] Service account key is uploaded to EAS (not stored locally)
- [ ] `credentials.json` is in `.gitignore`
- [ ] `*.jks` and `*.keystore` are in `.gitignore`
- [ ] Service account has minimal required permissions
- [ ] Team members who need access have documented procedures

---

## Quick Start Summary

For the fastest setup:

1. **Configure package name** in `app.json`
2. **Run first build** and let EAS generate credentials:
   ```bash
   eas build --platform android --profile production
   ```
3. **For automated publishing**, set up a Google Service Account and upload to EAS
4. **Submit to Play Store**:
   ```bash
   eas submit --platform android
   ```

That's it! EAS handles the complexity of credential management for you.
