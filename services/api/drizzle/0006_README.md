# Migration 0006: Add Profile Onboarding Fields

## Purpose
Adds support for storing complete onboarding data in the profiles table, fixing the issue where profile fields collected during onboarding were not persisted to Supabase.

## Changes
This migration adds the following columns to the `profiles` table:

1. **title** (text) - User's professional title or role (e.g., "Full Stack Developer")
2. **location** (text) - User's geographic location (e.g., "San Francisco, CA")
3. **skills** (jsonb) - Array of user's skills stored as JSONB (e.g., ["React", "Node.js"])
4. **onboarding_completed** (boolean) - Flag indicating if user has completed the onboarding flow

## How to Apply
This migration should be applied via the migration runner or directly in Supabase SQL editor:

```bash
# Using the migration runner (if available)
cd services/api
npm run db:migrate

# Or manually in Supabase SQL editor
# Copy and paste the contents of 0006_add_profile_onboarding_fields.sql
```

## Impact
- **Breaking Changes**: None - all new columns are nullable or have defaults
- **Data Loss**: No existing data is affected
- **Backward Compatibility**: Fully backward compatible - old code will continue to work

## Testing
After applying this migration:
1. Complete the onboarding flow as a new user
2. Verify all fields (username, title, location, skills, bio, avatar) are saved
3. Check the profile screen displays all the saved data
4. Verify the data persists across app restarts

## Related Files
- `app/onboarding/details.tsx` - Updated to save all fields to Supabase
- `lib/services/auth-profile-service.ts` - Updated to load new fields
- `database/schema.sql` - Updated main schema file
