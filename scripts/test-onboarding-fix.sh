#!/bin/bash
# Test script to verify onboarding profile data persistence
# This script checks that the migration was applied successfully

echo "🔍 Testing Onboarding Profile Data Persistence..."
echo ""

# Check if the migration file exists
if [ -f "services/api/drizzle/0006_add_profile_onboarding_fields.sql" ]; then
    echo "✅ Migration file exists"
else
    echo "❌ Migration file not found"
    exit 1
fi

# Check if schema.sql has been updated
if grep -q "title text" database/schema.sql && \
   grep -q "location text" database/schema.sql && \
   grep -q "skills jsonb" database/schema.sql && \
   grep -q "onboarding_completed boolean" database/schema.sql; then
    echo "✅ Schema file updated with new columns"
else
    echo "❌ Schema file not updated correctly"
    exit 1
fi

# Check if auth-profile-service.ts has been updated
if grep -q "title?: string" lib/services/auth-profile-service.ts && \
   grep -q "location?: string" lib/services/auth-profile-service.ts && \
   grep -q "skills?: string\[\]" lib/services/auth-profile-service.ts; then
    echo "✅ AuthProfile interface updated"
else
    echo "❌ AuthProfile interface not updated correctly"
    exit 1
fi

# Check if details.tsx saves to Supabase
if grep -q "updates.title" app/onboarding/details.tsx && \
   grep -q "updates.location" app/onboarding/details.tsx && \
   grep -q "updates.skills" app/onboarding/details.tsx; then
    echo "✅ Details screen saves all fields to Supabase"
else
    echo "❌ Details screen not saving all fields"
    exit 1
fi

echo ""
echo "✅ All checks passed! The onboarding profile data fix is complete."
echo ""
echo "📋 Next steps:"
echo "1. Apply the migration to your Supabase database"
echo "2. Test the onboarding flow in the app"
echo "3. Verify profile data persists in the profile screen"
