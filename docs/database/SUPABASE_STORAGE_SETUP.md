# Supabase Storage Setup Guide

This guide explains how to set up Supabase Storage for handling attachments in BOUNTYExpo.

## Overview

BOUNTYExpo uses Supabase Storage as the primary storage solution with AsyncStorage as a fallback. This ensures:
- ✅ Scalable file storage in production
- ✅ Offline/development support via AsyncStorage
- ✅ Automatic fallback if Supabase is unavailable

## Storage Buckets

The app uses the following storage buckets:

1. **`attachments`** - General purpose attachments (bounty files, documents)
2. **`bounty-attachments`** - Bounty-specific attachments
3. **`profiles`** - User profile images (avatars and banners)
   - `profiles/avatars/` - Profile pictures
   - `profiles/banners/` - Profile banner images

## Setup Instructions

### Step 1: Create Storage Buckets

1. Go to your Supabase project dashboard at https://app.supabase.com
2. Navigate to **Storage** in the left sidebar
3. Click **New Bucket**
4. Create the following buckets:

#### Bucket: `attachments`
- **Name**: `attachments`
- **Public**: ✅ Yes (allow public access)
- **File size limit**: 10MB
- **Allowed MIME types**: All types

#### Bucket: `bounty-attachments`
- **Name**: `bounty-attachments`
- **Public**: ✅ Yes (allow public access)
- **File size limit**: 10MB
- **Allowed MIME types**: All types

#### Bucket: `profiles`
- **Name**: `profiles`
- **Public**: ✅ Yes (allow public access)
- **File size limit**: 5MB
- **Allowed MIME types**: `image/jpeg`, `image/png`, `image/webp`, `image/gif`

### Step 2: Configure Storage Policies

For each bucket, you need to set up Row Level Security (RLS) policies.

#### Policy for `attachments` bucket

```sql
-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'attachments');

-- Allow authenticated users to read their own files
CREATE POLICY "Users can read attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'attachments');

-- Allow users to delete their own files
CREATE POLICY "Users can delete their own attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'attachments' AND auth.uid()::text = owner);
```

#### Policy for `bounty-attachments` bucket

```sql
-- Allow authenticated users to upload bounty attachments
CREATE POLICY "Authenticated users can upload bounty attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'bounty-attachments');

-- Allow anyone to read bounty attachments (public bounties)
CREATE POLICY "Anyone can read bounty attachments"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'bounty-attachments');

-- Allow users to delete their own bounty attachments
CREATE POLICY "Users can delete their own bounty attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'bounty-attachments' AND auth.uid()::text = owner);
```

#### Policy for `profiles` bucket

```sql
-- Allow authenticated users to upload profile images
CREATE POLICY "Authenticated users can upload profile images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'profiles');

-- Allow anyone to view profile images (public profiles)
CREATE POLICY "Anyone can view profile images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'profiles');

-- Allow users to update their own profile images
CREATE POLICY "Users can update their own profile images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'profiles' AND auth.uid()::text = owner);

-- Allow users to delete their own profile images
CREATE POLICY "Users can delete their own profile images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'profiles' AND auth.uid()::text = owner);
```

### Step 3: Apply Policies via Supabase Dashboard

1. Go to **Storage** → Click on a bucket
2. Click **Policies** tab
3. Click **New Policy**
4. Choose **Create policy from template** or **Create custom policy**
5. Paste the SQL from above and click **Review**
6. Click **Save policy**

Repeat for each bucket.

### Step 4: Configure Environment Variables

Ensure your `.env` file has the Supabase credentials:

```env
# Supabase Configuration
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

⚠️ **Important**: Never commit your actual keys to version control!

## AsyncStorage Fallback

If Supabase is not configured or unavailable, the app automatically falls back to AsyncStorage:

- Files are stored as base64-encoded data URIs
- Limited to smaller files (AsyncStorage has size limits ~6MB on iOS, ~10MB on Android)
- Data persists locally on the device
- Useful for development and offline scenarios

## File Size Limits

| Bucket | Max Size | Recommended |
|--------|----------|-------------|
| `attachments` | 10MB | Use for documents, PDFs, small files |
| `bounty-attachments` | 10MB | Use for bounty proof, reference files |
| `profiles/avatars` | 5MB | Use for profile pictures |
| `profiles/banners` | 5MB | Use for profile banners |

## Testing Storage Setup

To verify your storage is working:

1. Start the app: `npm start`
2. Go to **Create Bounty** → **Details** step
3. Try uploading a photo or document
4. Check Supabase dashboard under **Storage** → **attachments**
5. You should see your uploaded file

## Troubleshooting

### Issue: "Upload failed" error

**Solution**: Check that:
- Supabase URL and anon key are correct in `.env`
- Storage buckets exist in Supabase dashboard
- RLS policies are properly configured
- You're authenticated (logged in)

### Issue: Files not appearing in Supabase

**Solution**: Check:
- Bucket is set to **Public**
- RLS policies allow INSERT for authenticated users
- Network connection is active

### Issue: "Permission denied" error

**Solution**: 
- Verify RLS policies are set up correctly
- Ensure user is authenticated
- Check that policy conditions match (e.g., `auth.uid()::text = owner`)

### Issue: AsyncStorage fallback being used unexpectedly

**Solution**:
- Verify `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set
- Restart Metro bundler after changing `.env`
- Check console logs for Supabase initialization errors

## Migration from Simulated Storage

If you were using the simulated attachment service:

1. Existing "uploads" will have fake URLs (`https://files.example.com/...`)
2. These won't be accessible in production
3. Users should re-upload attachments after Supabase setup
4. Consider adding a migration script to handle existing data if needed

## Security Best Practices

1. **Never expose service_role key** - Only use anon key in the app
2. **Use RLS policies** - Always enable Row Level Security on storage
3. **Validate file types** - Check MIME types before upload
4. **Limit file sizes** - Enforce size limits in both client and storage
5. **Scan for malware** - Consider adding virus scanning for user uploads
6. **Monitor usage** - Check Supabase dashboard for storage usage metrics

## Additional Resources

- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [Supabase RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Expo FileSystem Documentation](https://docs.expo.dev/versions/latest/sdk/filesystem/)
- [Expo ImagePicker Documentation](https://docs.expo.dev/versions/latest/sdk/imagepicker/)

## Support

If you encounter issues with storage setup:
1. Check the troubleshooting section above
2. Review Supabase logs in the dashboard
3. Check browser/app console for error messages
4. Refer to the Supabase community forums
