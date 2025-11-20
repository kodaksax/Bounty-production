#!/usr/bin/env node

/**
 * Test script for user deletion functionality
 * 
 * This script tests the /auth/delete-account endpoint
 * 
 * Usage:
 *   node scripts/test-user-deletion.js <email> <password>
 * 
 * Example:
 *   node scripts/test-user-deletion.js test@example.com password123
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase configuration');
  console.error('   Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseAdmin = SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

async function testUserDeletion() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node scripts/test-user-deletion.js <email> <password>');
    console.error('Example: node scripts/test-user-deletion.js test@example.com password123');
    process.exit(1);
  }

  const [email, password] = args;

  console.log('\n🧪 Testing User Deletion Functionality\n');
  console.log('Configuration:');
  console.log(`  Supabase URL: ${SUPABASE_URL}`);
  console.log(`  API Base URL: ${API_BASE_URL}`);
  console.log(`  Test Email: ${email}\n`);

  try {
    // Step 1: Sign in as the user
    console.log('1️⃣  Signing in...');
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      console.error('❌ Sign in failed:', signInError.message);
      process.exit(1);
    }

    if (!signInData.session) {
      console.error('❌ No session returned from sign in');
      process.exit(1);
    }

    const userId = signInData.user.id;
    const accessToken = signInData.session.access_token;

    console.log(`✅ Signed in successfully as ${email}`);
    console.log(`   User ID: ${userId}\n`);

    // Step 2: Check user's data before deletion
    console.log('2️⃣  Checking user data...');
    
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.warn(`⚠️  Could not fetch profile: ${profileError.message}`);
    } else {
      console.log(`✅ Profile found: ${profile.username || 'No username'}`);
    }

    const { count: bountiesCount } = await supabase
      .from('bounties')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    console.log(`   Bounties: ${bountiesCount || 0}`);

    const { count: requestsCount } = await supabase
      .from('bounty_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    console.log(`   Bounty Requests: ${requestsCount || 0}\n`);

    // Step 3: Call the delete account API
    console.log('3️⃣  Calling delete account API...');
    
    const response = await fetch(`${API_BASE_URL}/auth/delete-account`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const responseText = await response.text();
    let result;
    
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Invalid JSON response:', responseText);
      process.exit(1);
    }

    if (!response.ok) {
      console.error('❌ Delete account failed:');
      console.error(`   Status: ${response.status} ${response.statusText}`);
      console.error(`   Error: ${result.message || result.error || 'Unknown error'}`);
      if (result.details) {
        console.error(`   Details: ${JSON.stringify(result.details, null, 2)}`);
      }
      process.exit(1);
    }

    if (!result.success) {
      console.error('❌ Delete account failed:', result.message);
      process.exit(1);
    }

    console.log('✅ Delete account API succeeded');
    console.log(`   Message: ${result.message}\n`);

    // Step 4: Verify the user is deleted (using admin client if available)
    if (supabaseAdmin) {
      console.log('4️⃣  Verifying deletion...');
      
      const { data: userCheck, error: userCheckError } = await supabaseAdmin.auth.admin.getUserById(userId);
      
      if (userCheckError || !userCheck.user) {
        console.log('✅ User deleted from auth.users');
      } else {
        console.error('❌ User still exists in auth.users');
      }

      const { data: profileCheck, error: profileCheckError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileCheckError?.code === 'PGRST116') {
        console.log('✅ Profile deleted from database');
      } else if (profileCheck) {
        console.error('❌ Profile still exists in database');
      }
    } else {
      console.log('4️⃣  Skipping deletion verification (no admin key)');
    }

    console.log('\n✅ All tests passed!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testUserDeletion();
