# User Verification Implementation Guide

## Overview

BountyExpo uses a two-phase verification approach to establish and communicate trust between bounty posters and hunters. Phase 1 (MVP) covers the essential checks that every user must complete before they can transact: email confirmation, phone OTP, government ID upload, a liveness selfie, minimum-age confirmation, and profile completeness. Phase 2 (Post-MVP) adds deeper trust signals — address verification, social-media account linking, third-party background checks, and peer endorsements — intended for high-value bounties and power users.

Verification matters in a bounty marketplace because real financial transactions occur between strangers. Fraudulent accounts, minors, and identity theft are active risks that erode platform trust and expose BountyExpo to regulatory liability. The layered approach lets the platform gate sensitive capabilities progressively rather than demanding maximum friction at sign-up.

`UserProfile.verificationStatus` in `lib/types.ts` is the **single source of truth for UI display**. It is a derived field (`'unverified' | 'pending' | 'verified'`) computed from the underlying boolean and timestamp columns on the `profiles` table and the Supabase Auth user record. All badge rendering and search filtering consume this field.

---

## Architecture Summary

| Verification Step | Phase | Status column / source | Key file(s) |
|---|---|---|---|
| Email confirmation | 1 | `auth.users.email_confirmed_at` | `providers/auth-provider.tsx`, `lib/services/auth-service.ts` |
| Phone OTP | 1 | `profiles.phone_verified`, `profiles.phone_verified_at` | `lib/services/phone-verification-service.ts`, `app/onboarding/phone.tsx`, `app/onboarding/verify-phone.tsx` |
| Government ID upload | 1 | `profiles.id_verification_status`, `profiles.id_submitted_at` | `app/verification/upload-id.tsx`, `supabase/functions/review-id/` |
| Selfie / liveness | 1 | `profiles.selfie_submitted_at` | `app/verification/selfie.tsx` *(to be created)* |
| Minimum age check | 1 | `profiles.age_verified`, `profiles.age_verified_at` | `supabase/migrations/20251126_add_age_verification_columns.sql` |
| Profile completeness | 1 | `userProfileService.checkCompleteness()` | `lib/services/userProfile.ts`, `hooks/useUserProfile.ts` |
| Address verification | 2 | `profiles.address_verified`, `profiles.address_verified_at` | `server/`, Smarty Streets API |
| Social media linking | 2 | `linked_social_accounts` table | `supabase/config.toml`, `app/profile/` |
| Background checks | 2 | `profiles.background_check_status` | `server/`, Checkr / Sterling / Certn |
| Community endorsements | 2 | `endorsements` table | `lib/services/endorsement-service.ts` *(to be created)* |

### How `verificationStatus` flows through the system

```
Database columns (profiles table + auth.users)
         │
         ▼
lib/utils/normalize-profile.ts          ← converts raw DB row → UserProfile shape
         │
         ▼
UserProfile.verificationStatus          ← 'unverified' | 'pending' | 'verified'
         │
         ├──▶ lib/utils/verification-badges.ts   ← getVerificationBadges() / deriveVerificationStatus()
         │
         ├──▶ Profile screen badge chips          ← rendered from earned badges
         │
         ├──▶ UserSearchFilters.verificationStatus ← search/filter queries (lib/types.ts)
         │
         └──▶ lib/types-admin.ts                  ← admin filter adds 'all' option
```

The `'pending'` state is set automatically by the `review-id` Edge Function when a user submits their ID. The `'verified'` state is set by an admin reviewer (or by a future automated provider) after all Phase 1 checks pass. The UI derives which badges are earned independently from these columns via `getVerificationBadges()` so that partial progress is always visible.

---

## Phase 1 — Essential Verification (MVP)

### Step 1 — Email Verification

#### What already works

- Supabase populates `auth.users.email_confirmed_at` automatically when the user clicks the verification link in their signup email. This is the primary and most reliable signal.
- The full email gate (blocking bounty posting and applying) is already implemented and documented in `docs/AUTH_EMAIL_VERIFICATION_GATE.md`.
- **`lib/services/auth-service.ts`** exports `resendVerification(email)`, which calls `supabase.auth.resend({ type: 'signup', email })`, and `checkEmailVerified()`.
- **`providers/auth-provider.tsx`** already computes `isEmailVerified` from `session.user.email_confirmed_at` → `session.user.confirmed_at` → `profile.email_verified` in priority order and exposes it through `useAuthContext()`.

#### What to build

1. **Add a `✓ Email` badge to the profile card.** The badge should only render when `session.user.email_confirmed_at` is non-null. Never derive this from a local state variable — always read directly from the session to prevent stale state.

2. **Surface a resend prompt on the profile screen** for users whose email is unverified, so they can trigger a new email without navigating to a separate settings screen.

```typescript
// Example: reading email_confirmed_at from auth context and rendering a badge
import { useAuthContext } from 'hooks/use-auth-context';
import { View, Text, Pressable, Alert } from 'react-native';
import { resendVerification } from 'lib/services/auth-service';

export function EmailVerificationBadge() {
  const { session, isEmailVerified } = useAuthContext();

  if (isEmailVerified) {
    // Render the earned badge
    return (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>✓ Email</Text>
      </View>
    );
  }

  // Render the unverified prompt with a resend action
  return (
    <View style={styles.unverifiedRow}>
      <Text style={styles.unverifiedText}>Email not verified</Text>
      <Pressable
        onPress={async () => {
          if (!session?.user.email) return;
          const result = await resendVerification(session.user.email);
          Alert.alert(
            result.success ? 'Email sent' : 'Error',
            result.message
          );
        }}
      >
        <Text style={styles.resendLink}>Resend verification</Text>
      </Pressable>
    </View>
  );
}
```

---

### Step 2 — Phone Verification

#### What already exists

- **`lib/services/phone-verification-service.ts`** exports:
  - `sendPhoneOTP(phone)` — calls Supabase OTP with rate-limit / retry-after parsing
  - `verifyPhoneOTP(phone, token)` — validates the 6-digit code; on success already writes `phone_verified: true` and `phone_verified_at: new Date().toISOString()` to `supabase.auth.updateUser({ data: {...} })` (i.e., `auth.users.raw_user_meta_data`)
  - `checkPhoneVerified()` — reads from `user_metadata`
  - `updatePhoneNumber(phone)` — updates `auth.users.phone`
  - Internal helper `formatToE164()` — defaults to `+1` (US/Canada); has a `TODO` comment for international support
  - Constants: `OTP_LENGTH = 6`, `OTP_PATTERN = /^\d{6}$/`
- **`app/onboarding/phone.tsx`** — collects the phone number and sends the OTP. Phone is currently **optional**: `handleNext()` exits early with `router.push('/onboarding/done')` when `phone.trim()` is empty, and a `handleSkip` button does the same. The file contains the comment: *"Note: Phone will eventually be mandatory for verification"*.
- **`app/onboarding/verify-phone.tsx`** — 6-digit OTP input with auto-focus on mount, auto-submit on last digit entry, 60-second resend cooldown (`setResendCooldown(60)`), and a skip button.

#### Making phone mandatory

The following targeted changes convert the optional flow into a required step. If you need a feature-flag escape hatch during the rollout, wrap the removals behind a `REQUIRE_PHONE_VERIFICATION` constant rather than deleting code outright.

**File:** `app/onboarding/phone.tsx`

1. **Remove the early-exit path in `handleNext()`** that lets users skip past phone entry:

```typescript
// BEFORE — remove this early-exit block in handleNext():
if (!phone.trim()) {
  router.push('/onboarding/done');
  return;
}

// AFTER — handleNext() should validate and require a phone number:
if (!phone.trim()) {
  Alert.alert('Phone required', 'Please enter your phone number to continue.');
  return;
}
```

2. **Remove (or feature-flag) the skip button** in the same screen:

```typescript
// BEFORE — remove or conditionally hide this button:
<TouchableOpacity onPress={handleSkip}>
  <Text>Skip</Text>
</TouchableOpacity>

// AFTER — either delete it, or gate it:
{__DEV__ && (
  <TouchableOpacity onPress={handleSkip}>
    <Text>Skip (dev only)</Text>
  </TouchableOpacity>
)}
```

**File:** `app/onboarding/verify-phone.tsx`

Remove `handleSkip` or gate it behind a grace period (e.g., only allow skip if the user has previously verified their phone on a different device):

```typescript
// BEFORE — remove this handler and its button:
const handleSkip = () => router.push('/onboarding/done');

// AFTER — remove the handler entirely, or replace with:
// (no skip button rendered)
```

#### Storing `phone_verified` on the `profiles` table

`verifyPhoneOTP` currently writes `phone_verified` only to `auth.users.raw_user_meta_data`. The `profiles` table needs matching columns so that the verification status is queryable via PostgREST and visible in admin tooling without joining to the `auth` schema.

**Migration** — create `supabase/migrations/20260XXX_add_phone_verified_to_profiles.sql`:

```sql
-- Add phone verification tracking columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone_verified    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Index supports filtering/searching verified users
CREATE INDEX IF NOT EXISTS idx_profiles_phone_verified
  ON profiles(phone_verified);
```

After `verifyPhoneOTP` succeeds, also mirror the result to the `profiles` table. This can be done in the success handler inside `app/onboarding/verify-phone.tsx` or appended directly to `verifyPhoneOTP` in `lib/services/phone-verification-service.ts`:

```typescript
// Addition after supabase.auth.updateUser succeeds in verifyPhoneOTP,
// or in the success callback of app/onboarding/verify-phone.tsx

const { data: { session } } = await supabase.auth.getSession();
if (session?.user.id) {
  await supabase
    .from('profiles')
    .update({
      phone_verified:    true,
      phone_verified_at: new Date().toISOString(),
    })
    .eq('id', session.user.id);
}
```

> **Note on international numbers:** `formatToE164()` currently hard-codes `+1` for US/Canada. Before removing the phone skip, ensure users outside North America can enter their country code. The existing `TODO` comment in the service is the right place to add a country-code picker.

---

### Step 3 — Government ID Upload

#### What already exists

- **`app/verification/upload-id.tsx`** has:
  - A document type picker with three values: `driversLicense`, `passport`, `nationalId`
  - Front-image and back-image pickers using `expo-image-picker`
  - A benefits card explaining the verified badge, higher transaction limits, priority in bounty matching, and enhanced trust score
  - A privacy notice: *"Your ID is encrypted and securely stored. We only use it for verification purposes and never share it with third parties."*
  - A `handleSubmit` that is a **placeholder** — it runs a `setTimeout` of 2000 ms, then shows an `Alert` reading "typically within 24–48 hours"
  - A TODO comment listing three provider options: *"1. Onfido  2. Stripe Identity  3. Supabase Edge Function + Manual Review"*
- **`lib/services/storage-service.ts`** exports `storageService.uploadFile(uri, { bucket, path, onProgress })` which returns `{ success, url, error }`.
- **`lib/services/attachment-service.ts`** uses the `'attachments'` bucket via `storageService.uploadFile`.

#### What to build: wire `upload-id.tsx` to Supabase Storage

Replace the `handleSubmit` `setTimeout` placeholder with real upload logic. The storage path pattern for all verification documents is:

```
verification-docs/{userId}/id-front.jpg
verification-docs/{userId}/id-back.jpg     ← omitted when docType is 'passport'
```

File validation rules to enforce **before** upload:

- **Accepted MIME types:** `image/jpeg`, `image/png`, `image/heic`
- **Maximum file size:** 10 MB (`10 * 1024 * 1024` bytes)

```typescript
// app/verification/upload-id.tsx — replace the handleSubmit placeholder

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const handleSubmit = async () => {
  if (!frontImage) {
    Alert.alert('Missing image', 'Please add the front of your ID.');
    return;
  }
  if (selectedDocType !== 'passport' && !backImage) {
    Alert.alert('Missing image', 'Please add the back of your ID.');
    return;
  }

  // Validate MIME type and size for front image
  const frontInfo = await FileSystem.getInfoAsync(frontImage, { size: true });
  if ((frontInfo as any).size > MAX_FILE_SIZE) {
    Alert.alert('File too large', 'ID image must be under 10 MB.');
    return;
  }
  // (expo-image-picker returns mimeType on the asset; validate if available)

  setIsSubmitting(true);
  try {
    // 1. Upload front image
    const frontPath = `${session.user.id}/id-front.jpg`;
    const frontResult = await storageService.uploadFile(frontImage, {
      bucket: 'verification-docs',
      path: frontPath,
    });
    if (!frontResult.success) throw new Error(frontResult.error);

    // 2. Upload back image (not required for passport)
    if (selectedDocType !== 'passport' && backImage) {
      const backPath = `${session.user.id}/id-back.jpg`;
      const backResult = await storageService.uploadFile(backImage, {
        bucket: 'verification-docs',
        path: backPath,
      });
      if (!backResult.success) throw new Error(backResult.error);
    }

    // 3. Call Edge Function to record submission and trigger manual review
    const { error } = await supabase.functions.invoke('review-id', {
      body: { userId: session.user.id, docType: selectedDocType },
    });
    if (error) throw error;

    Alert.alert(
      'Submitted',
      'Your ID is under review — typically within 24–48 hours.',
      [{ text: 'OK', onPress: () => router.back() }]
    );
  } catch (err: any) {
    Alert.alert('Upload failed', err.message ?? 'Please try again.');
  } finally {
    setIsSubmitting(false);
  }
};
```

#### Edge Function stub: `supabase/functions/review-id/` (to be created)

Create the directory `supabase/functions/review-id/` and add `index.ts`. This function is intentionally thin — its job is to update the `profiles` row to `pending` and notify admins. The actual review is manual (Phase 1) or automated via a provider (Phase 2).

**What it must do:**
1. Verify the calling user's JWT (Supabase validates this automatically via the `Authorization` header when the function is deployed with JWT verification enabled)
2. Set `id_verification_status = 'pending'` and `id_submitted_at = now()` on `profiles`
3. Send an admin notification (email or insert into an `admin_notifications` table)
4. Return `{ success: true }`

```typescript
// supabase/functions/review-id/index.ts  (to be created)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  // Parse request body
  const { userId, docType } = await req.json();

  if (!userId || !docType) {
    return new Response(
      JSON.stringify({ error: 'userId and docType are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Use the service-role key so the function can write to profiles
  // regardless of RLS. JWT verification of the *calling* user is handled
  // by the Supabase gateway before this function runs.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Mark the submission as pending
  const { error } = await supabase
    .from('profiles')
    .update({
      id_verification_status: 'pending',
      id_submitted_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // TODO: send admin notification email via Resend/SendGrid
  // TODO: insert into admin_notifications table for in-app admin alert
  // Example:
  // await supabase.from('admin_notifications').insert({
  //   type: 'id_review_requested',
  //   payload: { userId, docType },
  //   created_at: new Date().toISOString(),
  // });

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
```

#### Required `profiles` table migration

**File:** `supabase/migrations/20260XXX_add_id_verification_columns.sql`

```sql
-- Add ID verification tracking columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS id_verification_status TEXT DEFAULT 'unverified'
    CHECK (id_verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS id_submitted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS id_reviewed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS id_reviewer_id   UUID REFERENCES auth.users(id);

-- Index supports admin dashboard filtering and verification status queries
CREATE INDEX IF NOT EXISTS idx_profiles_id_verification_status
  ON profiles(id_verification_status);
```

#### Manual review workflow

The admin reviewer uses **`app/(admin)/users.tsx`**, which already filters users by `verificationStatus` via `lib/admin/adminDataClient.ts` (supporting `'all' | 'unverified' | 'pending' | 'verified'`).

**Reviewer workflow:**
1. Filter the admin user table to `verificationStatus = 'pending'`
2. Open the user's profile; follow the Supabase Storage link to `verification-docs/{userId}/`
3. Download `id-front.jpg` (and `id-back.jpg` if present) via a signed URL:
   ```typescript
   const { data } = await supabase.storage
     .from('verification-docs')
     .createSignedUrl(`${userId}/id-front.jpg`, 3600); // 1-hour expiry
   ```
4. Review the document. Update the user's row:
   - **Approve:** set `id_verification_status = 'verified'`, `id_reviewed_at = now()`, `id_reviewer_id = <adminUserId>`
   - **Reject:** set `id_verification_status = 'rejected'`, `id_reviewed_at = now()`, `id_reviewer_id = <adminUserId>`
5. Send the user a push notification or email with the outcome.

**Recommended columns to add to the admin users table view in `app/(admin)/users.tsx`:**

| Column label | Source |
|---|---|
| ID Status | `profiles.id_verification_status` |
| ID Submitted | `profiles.id_submitted_at` |
| ID Reviewed | `profiles.id_reviewed_at` |
| Reviewer | join `profiles.id_reviewer_id` → `profiles.username` |

---

### Step 4 — Selfie Matching

#### What to build

Create a new screen at **`app/verification/selfie.tsx`** (to be created). This screen launches the front-facing camera, captures a selfie, uploads it to the same `verification-docs` bucket under the user's folder, and records the submission timestamp.

**Key implementation points:**
- Use `expo-image-picker` with `cameraType: ImagePicker.CameraType.front` to enforce front-camera capture
- Storage path: `verification-docs/{userId}/selfie.jpg` — same bucket as ID documents so admin reviewers can compare both side-by-side
- After a successful upload, invoke the `review-id` Edge Function with a `step: 'selfie'` parameter, or extend the function to handle a `step` field alongside `docType`
- Required new `profiles` column:

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS selfie_submitted_at TIMESTAMPTZ;
```

**MVP vs automation path:**

| Approach | Effort | Notes |
|---|---|---|
| Manual side-by-side review | Low | Admin compares `selfie.jpg` + `id-front.jpg` in Supabase Storage console using signed URLs |
| Onfido | Medium | Integrates with existing TODO in `app/verification/upload-id.tsx`; handles both ID and liveness in one SDK |
| Stripe Identity | Medium | Integrates with existing Stripe setup in `supabase/functions/payments/`; charges per verification |
| AWS Rekognition | High | `CompareFaces` API; requires separate AWS account and IAM keys |

**TypeScript skeleton for `app/verification/selfie.tsx`:**

```typescript
// app/verification/selfie.tsx  (to be created)
import React, { useState } from 'react';
import { View, Text, Pressable, Alert, Image, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { storageService } from 'lib/services/storage-service';
import { supabase } from 'lib/supabase';
import { useAuthContext } from 'hooks/use-auth-context';

export default function SelfieScreen() {
  const { session } = useAuthContext();
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const captureSelfie = async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) {
      Alert.alert(
        'Camera permission required',
        'Please allow camera access in your device settings.'
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: false,
    });
    if (!result.canceled) {
      setSelfieUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!selfieUri || !session?.user.id) return;

    setIsSubmitting(true);
    try {
      const path = `${session.user.id}/selfie.jpg`;
      const result = await storageService.uploadFile(selfieUri, {
        bucket: 'verification-docs',
        path,
      });
      if (!result.success) throw new Error(result.error);

      // Record submission timestamp on profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ selfie_submitted_at: new Date().toISOString() })
        .eq('id', session.user.id);
      if (profileError) throw profileError;

      // Notify review queue
      const { error: fnError } = await supabase.functions.invoke('review-id', {
        body: { userId: session.user.id, step: 'selfie' },
      });
      if (fnError) throw fnError;

      Alert.alert(
        'Selfie submitted',
        'We will compare your selfie with your ID during review.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err: any) {
      Alert.alert('Upload failed', err.message ?? 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Take a Selfie</Text>
      <Text style={styles.subtitle}>
        We'll compare your selfie with your ID to confirm your identity.
        This image is stored securely and deleted after review.
      </Text>

      {selfieUri ? (
        <Image source={{ uri: selfieUri }} style={styles.preview} />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>No selfie captured yet</Text>
        </View>
      )}

      <Pressable style={styles.captureButton} onPress={captureSelfie}>
        <Text style={styles.captureButtonText}>
          {selfieUri ? 'Retake Selfie' : 'Take Selfie'}
        </Text>
      </Pressable>

      {selfieUri && (
        <Pressable
          style={[styles.submitButton, isSubmitting && styles.disabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Text style={styles.submitButtonText}>
            {isSubmitting ? 'Uploading…' : 'Submit for Review'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, padding: 24, backgroundColor: '#fff' },
  title:           { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  subtitle:        { fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 20 },
  preview:         { width: '100%', height: 300, borderRadius: 12, marginBottom: 16 },
  placeholder:     { width: '100%', height: 300, backgroundColor: '#f0f0f0',
                     borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                     marginBottom: 16 },
  placeholderText: { color: '#999' },
  captureButton:   { backgroundColor: '#1a1a2e', padding: 16, borderRadius: 10,
                     alignItems: 'center', marginBottom: 12 },
  captureButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  submitButton:    { backgroundColor: '#22c55e', padding: 16, borderRadius: 10,
                     alignItems: 'center' },
  submitButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  disabled:        { opacity: 0.5 },
});
```

---

### Step 5 — Minimum Age Check

#### What already exists

- **Migration `supabase/migrations/20251126_add_age_verification_columns.sql`** already:
  - Adds `age_verified BOOLEAN DEFAULT false` to `profiles`
  - Adds `age_verified_at TIMESTAMPTZ` to `profiles`
  - Backfills both columns from `auth.users.raw_user_meta_data->>'age_verified'` for existing users
  - Creates `idx_profiles_age_verified` index on `profiles(age_verified)`

No new migration is required for this step.

#### What to build

1. **Onboarding age-gate checkbox.** Add an age-confirmation checkbox to the onboarding flow (or to the sign-up form in `app/auth/sign-up-form.tsx`) with the copy: *"I confirm I am 18 years of age or older."* When the user checks this box and completes sign-up, set `age_verified: true` in `raw_user_meta_data` via `supabase.auth.updateUser`. The existing migration backfill already propagates this value from `raw_user_meta_data` to `profiles.age_verified` for new and existing users.

```typescript
// In sign-up or onboarding — set age_verified in user metadata
await supabase.auth.updateUser({
  data: {
    age_verified:    true,
    age_verified_at: new Date().toISOString(),
  },
});

// Then mirror to profiles table (the migration backfill handles existing rows,
// but new rows should be written explicitly on onboarding completion in done.tsx)
await supabase
  .from('profiles')
  .update({
    age_verified:    true,
    age_verified_at: new Date().toISOString(),
  })
  .eq('id', session.user.id);
```

2. **Manual age confirmation during ID review (Step 3).** During the ID review workflow described in Step 3, the admin reviewer extracts the date of birth from the ID image and calculates whether the user is aged 18 or over. If confirmed, the reviewer updates the row directly:

```sql
UPDATE profiles
SET
  age_verified    = true,
  age_verified_at = NOW()
WHERE id = '<userId>';
```

If the user is under 18, the reviewer sets `id_verification_status = 'rejected'` and initiates account suspension per the platform's underage-user policy.

3. **Gate UI.** Any screen that requires age verification (e.g., posting bounties above a value threshold, adult-content categories) should check `profile.age_verified === true` before proceeding:

```typescript
import { useUserProfile } from 'hooks/useUserProfile';

const { profile } = useUserProfile();

if (!profile?.age_verified) {
  return (
    <AgeGateBanner
      message="BountyExpo is only available to users aged 18 and over.
               By continuing, you confirm you meet this requirement."
    />
  );
}
```

> **Important:** The self-declared checkbox at sign-up is a soft check only. The hard confirmation happens during manual ID review in Step 3. Do not rely solely on the checkbox for age enforcement.

---

### Step 6 — Profile Completeness Gate

#### What already exists

- **`lib/services/userProfile.ts`** exports:
  - `userProfileService.checkCompleteness(userId)` — async, fetches the profile from the DB, returns `ProfileCompleteness { isComplete: boolean; missingFields: string[] }`
  - `checkProfileCompleteness(profile)` — synchronous helper; **currently only checks `username`**
- **`hooks/useUserProfile.ts`** exposes `isComplete` (boolean) and `completeness` (of type `ProfileCompleteness`) derived from the above service, plus `updateProfile()` and `refresh()`.

#### What to build

Extend `checkProfileCompleteness()` in **`lib/services/userProfile.ts`** to require all four fields that define a meaningful public presence before awarding the "Trusted" badge:

```typescript
// lib/services/userProfile.ts — extend checkProfileCompleteness()

export function checkProfileCompleteness(profile: ProfileData | null): ProfileCompleteness {
  if (!profile) {
    return {
      isComplete: false,
      missingFields: ['username', 'displayName', 'avatar', 'about'],
    };
  }

  const missingFields: string[] = [];

  // username maps to profiles.username
  if (!profile.username?.trim()) {
    missingFields.push('username');
  }

  // displayName maps to profiles.display_name
  if (!profile.displayName?.trim()) {
    missingFields.push('displayName');
  }

  // avatar maps to profiles.avatar_url
  if (!profile.avatar?.trim()) {
    missingFields.push('avatar');
  }

  // bio maps to profiles.about
  if (!profile.bio?.trim()) {
    missingFields.push('about');
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
}
```

Then use `useUserProfile().isComplete` as a gate in `getVerificationBadges()` (see [Badge System](#badge-system)):

```typescript
import { useUserProfile } from 'hooks/useUserProfile';
import { getVerificationBadges } from 'lib/utils/verification-badges';

const { completeness } = useUserProfile();

const badges = getVerificationBadges({
  // ... other inputs ...
  profileIsComplete: completeness?.isComplete,
});
```

The "Trusted Poster" badge is only awarded when `profileIsComplete === true` **and** all other Phase 1 checks pass (email, phone, ID verified). This gives users a clear signal that completing their profile has tangible value.

---

## Phase 2 — Enhanced Trust (Post-MVP)

### Step 7 — Address Verification

#### Option A — Utility Bill Upload

Reuse the same upload flow built in Step 3. A new document type `'utilityBill'` can be added to the document type picker in `app/verification/upload-id.tsx`, or a separate screen `app/verification/upload-address-doc.tsx` can be created.

Storage path: `verification-docs/{userId}/address-doc.jpg`

Required migration:

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS address_verified    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS address_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_address_verified
  ON profiles(address_verified);
```

The admin review workflow is identical to Step 3: reviewer downloads a signed URL, confirms the address matches the profile, then sets `address_verified = true`.

#### Option B — Automated Address API

**`ADDRESS_AUTOCOMPLETE_INTEGRATION.md`** (in the repo root) already references address autocomplete integration. Smarty Streets (SmartySDK) can verify addresses programmatically without requiring a document upload.

Integration point: a server-side call from the `server/` directory pattern. The flow would be:

1. User enters address during onboarding or profile settings
2. Client sends address to `server/verify-address` (new route) or a new Supabase Edge Function
3. Server calls the Smarty Streets API; on a confirmed match, sets `address_verified = true` and `address_verified_at = now()` on `profiles`

This approach is lower friction for the user but provides weaker fraud protection than a document upload (automated checks can be gamed with valid-but-stolen addresses). Consider combining both for high-value bounty posters.

---

### Step 8 — Social Media Linking

#### What already exists

- **`GOOGLE_OAUTH_REDIRECT_URI_FIX.md`** confirms Google OAuth is wired through Supabase Auth and the redirect URI is correctly configured.
- Supabase Auth already handles OAuth sessions; the enabled providers are controlled in the Supabase project dashboard and/or `supabase/config.toml`.

#### What to build

1. **Enable additional OAuth providers** in `supabase/config.toml`. Add Facebook and LinkedIn as enabled providers (requires registering an app on each platform and adding the client ID / secret to Supabase project secrets):

```toml
# supabase/config.toml — add to [auth.external] section
[auth.external.facebook]
enabled = true
client_id = "env(FACEBOOK_CLIENT_ID)"
secret = "env(FACEBOOK_SECRET)"

[auth.external.linkedin_oidc]
enabled = true
client_id = "env(LINKEDIN_CLIENT_ID)"
secret = "env(LINKEDIN_SECRET)"
```

2. **Create `app/profile/linked-accounts.tsx`** (new screen) showing which social providers have been connected and offering connect / disconnect actions.

3. **Store linked providers in a `linked_social_accounts` table** to allow multiple provider links per user and to support the "N social accounts linked" trust signal independently of the primary auth provider:

```sql
CREATE TABLE linked_social_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,       -- 'google' | 'facebook' | 'linkedin'
  provider_uid TEXT NOT NULL,       -- provider's internal user ID
  linked_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_linked_social_accounts_user
  ON linked_social_accounts(user_id);
```

---

### Step 9 — Background Checks

#### Integration pattern

Follow the server-side service pattern used in the `server/` directory. The background check is triggered server-side (never directly from the client) to avoid exposing provider API keys.

**Third-party providers:**

| Provider | Geography | Notes |
|---|---|---|
| **Checkr** | US-focused | REST API; webhooks for async completion events; good developer experience |
| **Sterling** | Enterprise / international | Requires account manager; more thorough checks |
| **Certn** | Canada / international | Developer-friendly REST API; good for cross-border marketplace |

**Trigger condition:** Background checks should be optional and triggered only for high-value bounties — for example, when a bounty amount exceeds a threshold (e.g., `bountyAmount > 500`). Gate the background check prompt inside the bounty creation flow, specifically at the review step in `app/screens/CreateBounty/StepReview.tsx`.

**Required column:**

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS background_check_status TEXT DEFAULT 'not_requested'
    CHECK (background_check_status IN (
      'not_requested', 'requested', 'processing', 'clear', 'failed'
    )),
  ADD COLUMN IF NOT EXISTS background_check_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_background_check_status
  ON profiles(background_check_status);
```

**Server-side flow sketch:**

```typescript
// server/routes/background-check.ts  (to be created)
// POST /api/background-check/request
// Body: { userId: string }
// Auth: service-role JWT or user JWT with RLS check

import { checkrClient } from 'server/lib/checkr-client'; // to be created

export async function requestBackgroundCheck(userId: string) {
  // 1. Mark as requested
  await supabase
    .from('profiles')
    .update({
      background_check_status:       'requested',
      background_check_requested_at: new Date().toISOString(),
    })
    .eq('id', userId);

  // 2. Create a Checkr candidate and invitation
  const invitation = await checkrClient.createInvitation({ userId });

  // 3. Return the invitation URL to the client for redirect
  return { invitationUrl: invitation.url };
}
```

---

### Step 10 — Community Endorsements

#### Data model

```sql
CREATE TABLE endorsements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endorser_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endorsed_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bounty_id   UUID REFERENCES bounties(id) ON DELETE SET NULL,
  message     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  -- Prevent duplicate endorsements on the same bounty
  UNIQUE(endorser_id, endorsed_id, bounty_id)
);

CREATE INDEX idx_endorsements_endorsed_id
  ON endorsements(endorsed_id);

CREATE INDEX idx_endorsements_bounty_id
  ON endorsements(bounty_id);
```

**Eligibility rule:** A user may endorse another only when `bounty_id` references a bounty where both the `endorser_id` and `endorsed_id` participated and the bounty's `status` is `'completed'`. Enforce this at the RLS policy level:

```sql
-- RLS policy: users can only insert endorsements for completed bounties
-- where they were a participant
CREATE POLICY "endorsements_insert_policy"
ON endorsements FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = endorser_id
  AND EXISTS (
    SELECT 1 FROM bounties b
    WHERE b.id = bounty_id
      AND b.status = 'completed'
      AND (b.poster_id = auth.uid() OR b.hunter_id = auth.uid())
      AND (b.poster_id = endorsed_id OR b.hunter_id = endorsed_id)
  )
);
```

#### Service pattern

Model after **`lib/services/ratings.ts`** — `ratingsService.create()` inserts into the `user_ratings` table. Create **`lib/services/endorsement-service.ts`** (to be created):

```typescript
// lib/services/endorsement-service.ts  (to be created)
import { supabase } from 'lib/supabase';

export interface Endorsement {
  id:          string;
  endorserId:  string;
  endorsedId:  string;
  bountyId:    string;
  message?:    string;
  createdAt:   string;
}

export const endorsementService = {
  /**
   * Create an endorsement after a completed bounty.
   * Relies on RLS to enforce eligibility.
   */
  async create(params: {
    endorserId: string;
    endorsedId: string;
    bountyId:   string;
    message?:   string;
  }): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase.from('endorsements').insert({
      endorser_id: params.endorserId,
      endorsed_id: params.endorsedId,
      bounty_id:   params.bountyId,
      message:     params.message ?? null,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  },

  /** Retrieve all endorsements received by a user, newest first. */
  async listForUser(userId: string): Promise<Endorsement[]> {
    const { data, error } = await supabase
      .from('endorsements')
      .select('*')
      .eq('endorsed_id', userId)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(row => ({
      id:         row.id,
      endorserId: row.endorser_id,
      endorsedId: row.endorsed_id,
      bountyId:   row.bounty_id,
      message:    row.message,
      createdAt:  row.created_at,
    }));
  },

  /** Check whether endorser has already endorsed endorsed_id on this bounty. */
  async hasEndorsed(
    endorserId: string,
    endorsedId: string,
    bountyId:   string
  ): Promise<boolean> {
    const { count } = await supabase
      .from('endorsements')
      .select('id', { count: 'exact', head: true })
      .eq('endorser_id', endorserId)
      .eq('endorsed_id', endorsedId)
      .eq('bounty_id',   bountyId);
    return (count ?? 0) > 0;
  },
};
```

**UI pattern:** Add an **Endorse** button on the completed-bounty detail view (similar to the follow button pattern in profile screens using `lib/services/follow-service.ts`). The button should be disabled if `hasEndorsed()` returns `true` or if the bounty status is not `'completed'`.

---

## Badge System

### Badge Tiers

| Badge | Label | Column(s) / Source | Tier |
|---|---|---|---|
| Email Verified | ✓ Email | `auth.users.email_confirmed_at` (non-null) | 1 |
| Phone Verified | ✓ Phone | `profiles.phone_verified = true` | 1 |
| ID Verified | ✓ ID | `profiles.id_verification_status = 'verified'` | 2 |
| Age Verified | ✓ 18+ | `profiles.age_verified = true` | 2 |
| Trusted Poster | ✓ Trusted | email + phone + ID + `profileIsComplete` (all 4 profile fields) | 3 |

All top-level badge status values flow through `UserProfile.verificationStatus` (`'unverified' | 'pending' | 'verified'`) defined in `lib/types.ts`. The `'pending'` value represents a user who has submitted their ID but has not yet been reviewed. Individual badge components are driven by the more granular column values via `getVerificationBadges()`.

> **Admin filtering note:** `lib/types-admin.ts` extends `verificationStatus` with an additional `'all'` option used exclusively in `lib/admin/adminDataClient.ts` for unfiltered admin queries. Never pass `'all'` to `UserProfile.verificationStatus` — it is an admin-only filter value.

### `getVerificationBadges()` helper

Create **`lib/utils/verification-badges.ts`** (to be created):

```typescript
// lib/utils/verification-badges.ts  (to be created)
import type { UserProfile } from '../types';

export interface VerificationBadge {
  id:     'email' | 'phone' | 'id' | 'age' | 'trusted';
  label:  string;
  earned: boolean;
}

export interface VerificationBadgeInput {
  /** From session.user.email_confirmed_at — non-null means email is confirmed */
  emailConfirmedAt?:    string | null;
  /** From profiles.phone_verified */
  phoneVerified?:       boolean;
  /** From profiles.id_verification_status */
  idVerificationStatus?: string;
  /** From profiles.age_verified */
  ageVerified?:         boolean;
  /** From userProfileService.checkCompleteness() */
  profileIsComplete?:   boolean;
}

/**
 * Compute which verification badges a user has earned.
 * All inputs are optional so the function is safe to call before the profile loads.
 */
export function getVerificationBadges(input: VerificationBadgeInput): VerificationBadge[] {
  const emailEarned   = Boolean(input.emailConfirmedAt);
  const phoneEarned   = Boolean(input.phoneVerified);
  const idEarned      = input.idVerificationStatus === 'verified';
  const ageEarned     = Boolean(input.ageVerified);
  // "Trusted Poster" requires all four prerequisites
  const trustedEarned =
    emailEarned &&
    phoneEarned &&
    idEarned &&
    Boolean(input.profileIsComplete);

  return [
    { id: 'email',   label: '✓ Email',   earned: emailEarned   },
    { id: 'phone',   label: '✓ Phone',   earned: phoneEarned   },
    { id: 'id',      label: '✓ ID',      earned: idEarned      },
    { id: 'age',     label: '✓ 18+',     earned: ageEarned     },
    { id: 'trusted', label: '✓ Trusted', earned: trustedEarned },
  ];
}

/**
 * Derive the UserProfile.verificationStatus string from the badge inputs.
 * Used when writing back to profiles.verification_status or passing to
 * UserSearchFilters.verificationStatus.
 *
 * Logic:
 *   - 'verified'  → the Trusted badge is earned (all checks passed)
 *   - 'pending'   → ID has been submitted but not yet reviewed
 *   - 'unverified' → everything else
 */
export function deriveVerificationStatus(
  input: VerificationBadgeInput
): UserProfile['verificationStatus'] {
  const badges      = getVerificationBadges(input);
  const trusted     = badges.find(b => b.id === 'trusted');
  const idIsPending = input.idVerificationStatus === 'pending';

  if (trusted?.earned) return 'verified';
  if (idIsPending)     return 'pending';
  return 'unverified';
}
```

### Badge component usage

```typescript
// Example usage in a profile screen component
import { useAuthContext } from 'hooks/use-auth-context';
import { useUserProfile } from 'hooks/useUserProfile';
import { getVerificationBadges } from 'lib/utils/verification-badges';
import { View, Text, StyleSheet } from 'react-native';

export function VerificationBadgeRow() {
  const { session }                        = useAuthContext();
  const { profile, completeness }          = useUserProfile();

  const badges = getVerificationBadges({
    emailConfirmedAt:    session?.user.email_confirmed_at,
    phoneVerified:       profile?.phone_verified,
    idVerificationStatus: profile?.id_verification_status,
    ageVerified:         profile?.age_verified,
    profileIsComplete:   completeness?.isComplete,
  });

  const earnedBadges = badges.filter(b => b.earned);

  if (earnedBadges.length === 0) return null;

  return (
    <View style={styles.row}>
      {earnedBadges.map(badge => (
        <View key={badge.id} style={styles.chip}>
          <Text style={styles.chipText}>{badge.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip:     { backgroundColor: '#dcfce7', borderRadius: 12, paddingHorizontal: 10,
              paddingVertical: 4 },
  chipText: { color: '#166534', fontSize: 12, fontWeight: '600' },
});
```

---

## Data Privacy & Transparency

### Data Collected and Why

| Data | Why collected | Where stored |
|---|---|---|
| Email address | Account identity; verification gate for posting and applying | `auth.users.email` (Supabase Auth) |
| Phone number | OTP verification; two-factor account security | `auth.users.phone` + `profiles.phone_verified` |
| Government ID images | Identity fraud prevention; confirm real-world identity | Supabase Storage `verification-docs/` bucket (private) |
| Selfie image | Liveness check; match against submitted ID | Supabase Storage `verification-docs/` bucket (private) |
| Date of birth (extracted) | Age ≥ 18 check only | `profiles.age_verified` boolean — **raw DOB is NOT stored** |
| Address | Trust signal for high-value bounties | `profiles.address_verified` boolean; optional document in Storage |
| Background check result | Trust signal for high-value bounties | `profiles.background_check_status` enum — raw report NOT stored on BountyExpo servers |

### Supabase Storage RLS for `verification-docs`

The `verification-docs` bucket **must be created as private** (not public) in the Supabase dashboard. Apply the following RLS storage policies:

```sql
-- Allow authenticated users to upload their own verification documents.
-- The folder name must equal the user's UUID to enforce ownership.
CREATE POLICY "Users can upload own verification docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'verification-docs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to read back their own documents.
CREATE POLICY "Users can read own verification docs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'verification-docs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- The service_role already has full access by default in Supabase.
-- Admins and Edge Functions should use supabase.storage
--   .from('verification-docs').createSignedUrl(path, 3600)
-- to generate time-limited signed URLs for document review.
-- Never make the bucket or its objects publicly accessible.
```

> **Accessing documents as an admin reviewer:**
> ```typescript
> // In admin tooling — generate a 1-hour signed URL for review
> const { data, error } = await supabase.storage
>   .from('verification-docs')
>   .createSignedUrl(`${userId}/id-front.jpg`, 3600);
> // data.signedUrl is safe to open in a browser tab
> ```

### Data Retention Policy

| Data type | Retention period | Action at expiry |
|---|---|---|
| ID images (verified) | 30 days after `profiles.id_reviewed_at` | Delete from `verification-docs/` bucket via `storage.remove()` |
| ID images (rejected) | 7 days after `profiles.id_reviewed_at` | Delete from `verification-docs/` bucket via `storage.remove()` |
| Selfie images | Same schedule as ID images for the same submission | Delete from `verification-docs/` bucket |
| Address documents | 30 days after `profiles.address_verified_at` | Delete from `verification-docs/` bucket |
| `profiles.id_verification_status` | Retained indefinitely | Column value preserved; only the image files are deleted |
| Background check reports | Not stored on BountyExpo | Stored only at the provider (Checkr/Sterling/Certn) |

Implement retention cleanup as a Supabase scheduled function (pg_cron) or a cron Edge Function. See `CRON_SETUP_GUIDE.md` for the project's existing cron patterns.

### GDPR / CCPA — Right to Erasure

**`lib/services/account-deletion-service.ts`** already handles user deletion per the GDPR right to erasure. Extend it to cover all verification artefacts:

```typescript
// Addition to lib/services/account-deletion-service.ts
// Call this block inside the existing deletion flow, before or alongside
// the profile row deletion.

const verificationDocPaths = [
  `${userId}/id-front.jpg`,
  `${userId}/id-back.jpg`,
  `${userId}/selfie.jpg`,
  `${userId}/address-doc.jpg`,
];

// Remove all verification documents from Storage (errors are non-fatal —
// the file may not exist if the user never uploaded it)
await supabase.storage
  .from('verification-docs')
  .remove(verificationDocPaths);

// Null-out all verification columns so the row can be retained for
// referential integrity (bounty history, ratings) without PII
await supabase
  .from('profiles')
  .update({
    id_verification_status: null,
    id_submitted_at:        null,
    id_reviewed_at:         null,
    id_reviewer_id:         null,
    selfie_submitted_at:    null,
    phone_verified:         false,
    phone_verified_at:      null,
    age_verified:           false,
    age_verified_at:        null,
    address_verified:       false,
    address_verified_at:    null,
  })
  .eq('id', userId);
```

### User-Facing Explanation Copy

The following copy strings are ready to use directly in the UI. They are written to be clear, non-alarming, and compliant with GDPR transparency requirements.

| Screen / context | Copy |
|---|---|
| Email gate (posting / applying) | "Please verify your email to continue. Check your inbox for a verification link." |
| Phone onboarding screen | "Your phone number stays private and is never shown to other users. It's used only for account security." |
| ID upload screen | "Your ID is encrypted and stored securely. It's used only to confirm your identity and is never shared with third parties." |
| Selfie screen | "We'll compare your selfie with your ID to confirm your identity. This image is stored securely and deleted after review." |
| Age gate | "BountyExpo is only available to users aged 18 and over. By continuing, you confirm you meet this requirement." |
| Verification pending | "Your verification is under review. We'll notify you within 24–48 hours." |
| Verification approved | "🎉 You're verified! Your Trusted badge is now visible on your profile." |
| Verification rejected | "We were unable to verify your ID. Please re-submit with a clear, unobstructed photo. Contact support if you need help." |

---

## Implementation Checklist

### Phase 1 (MVP)

- [ ] **Email verification** (already in production) — add `✓ Email` badge to profile card; surface inline resend prompt for unverified users
- [ ] **Phone verification — make mandatory**
  - [ ] Remove early-exit skip path in `app/onboarding/phone.tsx` (`handleNext` check and skip button)
  - [ ] Remove skip button in `app/onboarding/verify-phone.tsx` (or gate behind a feature flag / `__DEV__` guard)
  - [ ] Address international number support — replace hard-coded `+1` in `formatToE164()` with a country-code picker before removing the phone skip
  - [ ] Write migration `supabase/migrations/20260XXX_add_phone_verified_to_profiles.sql`
  - [ ] After successful OTP in `verify-phone.tsx` (or in `verifyPhoneOTP`), write `phone_verified = true` and `phone_verified_at` to `profiles` table
- [ ] **ID upload — wire to Supabase Storage**
  - [ ] Create `verification-docs` private bucket in Supabase dashboard
  - [ ] Apply Storage RLS policies (`Users can upload own verification docs`, `Users can read own verification docs`)
  - [ ] Write migration `supabase/migrations/20260XXX_add_id_verification_columns.sql`
  - [ ] Replace `setTimeout` placeholder in `app/verification/upload-id.tsx` with real upload logic + Edge Function call
  - [ ] Add file-type validation (MIME: `image/jpeg`, `image/png`, `image/heic`) and size validation (max 10 MB)
  - [ ] Create `supabase/functions/review-id/index.ts` Edge Function (sets `id_verification_status = 'pending'`, notifies admin)
  - [ ] Add `id_verification_status`, `id_submitted_at`, `id_reviewed_at`, `id_reviewer_id` columns to admin users table view in `app/(admin)/users.tsx`
- [ ] **Selfie**
  - [ ] Create `app/verification/selfie.tsx` with front-camera capture using `expo-image-picker`
  - [ ] Wire capture → `verification-docs/{userId}/selfie.jpg` upload via `storageService.uploadFile`
  - [ ] Add `selfie_submitted_at TIMESTAMPTZ` column to `profiles`
  - [ ] Invoke `review-id` Edge Function with `step: 'selfie'` after upload
- [ ] **Age check**
  - [ ] Add age-confirmation checkbox ("I confirm I am 18 years of age or older") to sign-up or onboarding
  - [ ] On checkbox confirmation, set `age_verified: true` in `auth.users.raw_user_meta_data` and `profiles`
  - [ ] During manual ID review (Step 3), admin reviewer sets `age_verified = true` after extracting DOB from ID
  - [ ] (`age_verified` and `age_verified_at` columns already exist from `20251126_add_age_verification_columns.sql`)
- [ ] **Profile completeness gate**
  - [ ] Extend `checkProfileCompleteness()` in `lib/services/userProfile.ts` to require `displayName`, `avatar`, and `bio` in addition to `username`
  - [ ] Award "Trusted Poster" badge only when all completeness checks pass
- [ ] **Badge display**
  - [ ] Create `lib/utils/verification-badges.ts` with `getVerificationBadges()` and `deriveVerificationStatus()`
  - [ ] Render earned badges on the user's own profile screen
  - [ ] Render earned badges on public-facing user cards (bounty detail, hunter profiles)

### Phase 2 (Post-MVP)

- [ ] **Address verification**
  - [ ] Write migration to add `address_verified` and `address_verified_at` columns
  - [ ] Build address-document upload screen (reuse Step 3 pattern) and/or integrate Smarty Streets API
- [ ] **Social media linking**
  - [ ] Enable Facebook and LinkedIn OAuth providers in `supabase/config.toml`
  - [ ] Create `linked_social_accounts` table migration
  - [ ] Build `app/profile/linked-accounts.tsx` showing connected providers
- [ ] **Background checks**
  - [ ] Integrate Checkr / Sterling / Certn from `server/` directory
  - [ ] Write migration to add `background_check_status` and `background_check_requested_at` columns
  - [ ] Add background-check prompt to bounty creation flow for bounties above threshold
- [ ] **Community endorsements**
  - [ ] Write `endorsements` table migration with eligibility RLS policy
  - [ ] Create `lib/services/endorsement-service.ts` (`create`, `listForUser`, `hasEndorsed`)
  - [ ] Add Endorse button on completed-bounty detail view

### Data & Privacy

- [ ] Extend `lib/services/account-deletion-service.ts` to delete all files under `verification-docs/{userId}/` from Supabase Storage and null-out all verification columns
- [ ] Implement scheduled retention cleanup (delete verified/rejected ID images after 30/7 days respectively)
- [ ] Confirm that the full GDPR/CCPA deletion flow covers every verification column listed in the Right to Erasure section above
- [ ] Confirm the `verification-docs` bucket is marked **private** and is not publicly accessible

---

## Testing Guide

### Unit Tests

**`__tests__/unit/security/phone-verification.test.ts`** already exists. Extend it with the following additional cases:

```typescript
// Additions to __tests__/unit/security/phone-verification.test.ts

describe('checkPhoneVerified', () => {
  it('returns false when user_metadata.phone_verified is missing', async () => {
    // Mock supabase.auth.getUser() to return a user with no phone_verified key
    // in raw_user_meta_data
    mockGetUser({ user_metadata: {} });
    const result = await checkPhoneVerified();
    expect(result).toBe(false);
  });

  it('returns true when user_metadata.phone_verified is true', async () => {
    mockGetUser({ user_metadata: { phone_verified: true } });
    const result = await checkPhoneVerified();
    expect(result).toBe(true);
  });
});

describe('verifyPhoneOTP', () => {
  it('returns { success: false, error: "token_expired" } for expired tokens', async () => {
    // Mock supabase.auth.verifyOtp to return an error with message 'Token has expired'
    mockVerifyOtp({ error: { message: 'Token has expired' } });
    const result = await verifyPhoneOTP('+15551234567', '123456');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it('rejects tokens that do not match OTP_PATTERN (/^\\d{6}$/)', async () => {
    const result = await verifyPhoneOTP('+15551234567', 'abc123');
    expect(result.success).toBe(false);
  });
});
```

Add unit tests for the new badge utility:

```typescript
// __tests__/unit/utils/verification-badges.test.ts  (to be created)
import {
  getVerificationBadges,
  deriveVerificationStatus,
} from 'lib/utils/verification-badges';

describe('getVerificationBadges', () => {
  it('returns all badges earned when all inputs are truthy', () => {
    const badges = getVerificationBadges({
      emailConfirmedAt:    '2024-01-01T00:00:00Z',
      phoneVerified:       true,
      idVerificationStatus: 'verified',
      ageVerified:         true,
      profileIsComplete:   true,
    });
    expect(badges.every(b => b.earned)).toBe(true);
  });

  it('does not earn trusted badge when profile is incomplete', () => {
    const badges = getVerificationBadges({
      emailConfirmedAt:    '2024-01-01T00:00:00Z',
      phoneVerified:       true,
      idVerificationStatus: 'verified',
      ageVerified:         true,
      profileIsComplete:   false, // ← incomplete
    });
    const trusted = badges.find(b => b.id === 'trusted');
    expect(trusted?.earned).toBe(false);
  });

  it('returns all badges unearned when no inputs are provided', () => {
    const badges = getVerificationBadges({});
    expect(badges.every(b => !b.earned)).toBe(true);
  });
});

describe('deriveVerificationStatus', () => {
  it('returns "verified" when all checks pass', () => {
    const status = deriveVerificationStatus({
      emailConfirmedAt:    '2024-01-01T00:00:00Z',
      phoneVerified:       true,
      idVerificationStatus: 'verified',
      ageVerified:         true,
      profileIsComplete:   true,
    });
    expect(status).toBe('verified');
  });

  it('returns "pending" when idVerificationStatus is "pending"', () => {
    const status = deriveVerificationStatus({
      idVerificationStatus: 'pending',
    });
    expect(status).toBe('pending');
  });

  it('returns "unverified" for a brand-new user with no inputs', () => {
    const status = deriveVerificationStatus({});
    expect(status).toBe('unverified');
  });
});
```

### Integration Tests

| Scenario | Expected result |
|---|---|
| User submits ID without completing profile | ID upload proceeds and `id_verification_status` is set to `'pending'`; the "Trusted" badge is **not** awarded until all profile fields are filled and ID is `'verified'` |
| User skips phone (if feature-flagged in dev) | `profiles.phone_verified` remains `false`; `verificationStatus` remains `'unverified'`; phone badge is not rendered |
| Admin sets `id_verification_status = 'verified'` in DB | `deriveVerificationStatus()` returns `'verified'` for that user (when all other inputs are also truthy) |
| `getVerificationBadges()` called with all inputs `true` / `'verified'` | All 5 badges returned with `earned: true` |
| `getVerificationBadges()` with `idVerificationStatus = 'pending'` | `id` badge has `earned: false`; `deriveVerificationStatus()` returns `'pending'` |
| Account deletion triggered | All files under `verification-docs/{userId}/` removed from Storage; all verification columns nulled in `profiles` |
| Upload of file > 10 MB | Blocked client-side before `storageService.uploadFile` is called; user sees a size error message |
| Upload of PDF or non-image file | Blocked by MIME type check; user sees a file type error message |

### Manual QA Checklist

- [ ] Upload a valid JPEG ID image → upload succeeds; `id_verification_status` set to `'pending'` in DB; pending badge rendered
- [ ] Upload a valid PNG ID image → same result as JPEG
- [ ] Upload a file larger than 10 MB → blocked with user-facing "File too large" error; no upload attempted
- [ ] Upload a non-image file (e.g. PDF, HEVC video) → blocked with MIME type error; no upload attempted
- [ ] Admin approves ID in admin dashboard → `id_verification_status = 'verified'`; `id_reviewed_at` and `id_reviewer_id` set; user profile shows `✓ ID` badge
- [ ] Admin rejects ID → `id_verification_status = 'rejected'`; user notified with rejection copy
- [ ] Deleting account → confirms all files removed from `verification-docs/{userId}/`; verification columns nulled
- [ ] Unverified user attempts to post bounty → email verification gate blocks with correct copy (from `docs/AUTH_EMAIL_VERIFICATION_GATE.md`)
- [ ] Profile completeness gate → completing all four fields (`username`, `displayName`, `avatar`, `bio`) after email + phone + ID yields the `✓ Trusted` badge

---

## Related Documents

- `docs/AUTH_EMAIL_VERIFICATION_GATE.md` — Email verification gate implementation details and UI copy
- `SUPABASE_STORAGE_SETUP.md` — Storage bucket configuration patterns and RLS examples
- `ADDRESS_AUTOCOMPLETE_INTEGRATION.md` — Address autocomplete (Option B for Step 7)
- `GOOGLE_OAUTH_REDIRECT_URI_FIX.md` — OAuth provider configuration for social media linking (Step 8)
- `PAYMENT_SECURITY_COMPLIANCE.md` — Payment security context; overlaps with high-value bounty background check trigger
- `SECURITY_AUDIT_REPORT.md` — Security audit findings relevant to identity verification design decisions
- `CRON_SETUP_GUIDE.md` — Patterns for scheduled cleanup jobs (ID image retention)
- `supabase/migrations/20251126_add_age_verification_columns.sql` — Existing age verification migration
- `lib/services/phone-verification-service.ts` — Phone OTP service (all exports)
- `lib/services/auth-service.ts` — Email verification utilities (`resendVerification`, `checkEmailVerified`)
- `lib/services/account-deletion-service.ts` — GDPR deletion flow (extend for verification artefacts)
- `lib/services/userProfile.ts` — Profile completeness check (extend `checkProfileCompleteness`)
- `lib/services/ratings.ts` — Pattern to follow when building `endorsement-service.ts`
- `lib/services/storage-service.ts` — `storageService.uploadFile` used by all verification uploads
- `app/verification/upload-id.tsx` — ID upload screen (placeholder implementation to be wired up)
- `app/onboarding/phone.tsx` — Phone collection screen (skip path to be removed)
- `app/onboarding/verify-phone.tsx` — OTP verification screen (skip button to be removed)
- `app/(admin)/users.tsx` — Admin user table (add ID review columns)
- `hooks/useUserProfile.ts` — Exposes `isComplete`, `completeness`, `updateProfile`, `refresh`
