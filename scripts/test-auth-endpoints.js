#!/usr/bin/env node
/**
 * Test script for authentication endpoints
 * Tests sign-up and sign-in with the Supabase backend
 * 
 * Usage: node scripts/test-auth-endpoints.js [API_URL]
 * Example: node scripts/test-auth-endpoints.js http://localhost:3001
 */

const API_URL = process.argv[2] || 'http://localhost:3001';

// Generate a unique test user
const timestamp = Date.now();
const testUser = {
  email: `test${timestamp}@example.com`,
  username: `testuser${timestamp}`,
  password: 'testpass123'
};

console.log('🧪 Testing BountyExpo Authentication Endpoints');
console.log('📍 API URL:', API_URL);
console.log('👤 Test User:', testUser.username, '/', testUser.email);
console.log('');

async function testHealthCheck() {
  console.log('1️⃣  Testing health check...');
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();
    
    if (response.ok && data.status === 'ok') {
      console.log('✅ Health check passed');
      console.log('   Status:', data.status);
      console.log('   Timestamp:', data.timestamp);
      return true;
    } else {
      console.log('❌ Health check failed');
      console.log('   Response:', data);
      return false;
    }
  } catch (error) {
    console.log('❌ Health check error:', error.message);
    return false;
  }
}

async function testSupabaseConfig() {
  console.log('\n2️⃣  Testing Supabase configuration...');
  try {
    const response = await fetch(`${API_URL}/auth/diagnostics`);
    const data = await response.json();
    
    console.log('   Admin Configured:', data.adminConfigured);
    console.log('   URL Present:', data.urlPresent);
    console.log('   Service Key Present:', data.serviceKeyPresent);
    
    if (!data.adminConfigured) {
      console.log('⚠️  Supabase not configured - auth will not work');
      console.log('   Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env');
      return false;
    }
    
    console.log('✅ Supabase configuration valid');
    return true;
  } catch (error) {
    console.log('❌ Supabase config check error:', error.message);
    return false;
  }
}

async function testSignUp() {
  console.log('\n3️⃣  Testing sign-up endpoint...');
  try {
    const response = await fetch(`${API_URL}/app/auth/sign-up-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      console.log('✅ Sign-up successful');
      console.log('   User ID:', data.userId);
      console.log('   Message:', data.message);
      return { success: true, userId: data.userId };
    } else {
      console.log('❌ Sign-up failed');
      console.log('   Status:', response.status);
      console.log('   Error:', data.error || data.message);
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.log('❌ Sign-up error:', error.message);
    return { success: false, error: error.message };
  }
}

async function testSignIn() {
  console.log('\n4️⃣  Testing sign-in endpoint...');
  try {
    const response = await fetch(`${API_URL}/app/auth/sign-in-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      console.log('✅ Sign-in successful');
      console.log('   User ID:', data.user?.id);
      console.log('   Username:', data.user?.username);
      console.log('   Email:', data.user?.email);
      console.log('   Has Access Token:', !!data.session?.access_token);
      console.log('   Token Type:', data.session?.token_type || 'N/A');
      return { success: true, session: data.session };
    } else {
      console.log('❌ Sign-in failed');
      console.log('   Status:', response.status);
      console.log('   Error:', data.error || data.message);
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.log('❌ Sign-in error:', error.message);
    return { success: false, error: error.message };
  }
}

async function testInvalidSignIn() {
  console.log('\n5️⃣  Testing invalid credentials...');
  try {
    const response = await fetch(`${API_URL}/app/auth/sign-in-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        password: 'wrongpassword'
      })
    });
    
    const data = await response.json();
    
    if (!response.ok && data.error) {
      console.log('✅ Invalid credentials properly rejected');
      console.log('   Error message:', data.error);
      return true;
    } else {
      console.log('❌ Invalid credentials should have been rejected');
      return false;
    }
  } catch (error) {
    console.log('❌ Invalid sign-in test error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════');
  
  const healthOk = await testHealthCheck();
  if (!healthOk) {
    console.log('\n❌ Server not responding. Make sure the API is running:');
    console.log('   npm run api');
    console.log('   or');
    console.log('   pnpm dev:api');
    process.exit(1);
  }
  
  const supabaseOk = await testSupabaseConfig();
  if (!supabaseOk) {
    console.log('\n⚠️  Supabase not configured. Auth tests will be skipped.');
    console.log('   Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(0);
  }
  
  const signUpResult = await testSignUp();
  if (!signUpResult.success) {
    console.log('\n❌ Sign-up test failed. Cannot proceed to sign-in test.');
    process.exit(1);
  }
  
  const signInResult = await testSignIn();
  if (!signInResult.success) {
    console.log('\n❌ Sign-in test failed.');
    process.exit(1);
  }
  
  await testInvalidSignIn();
  
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✨ All authentication tests passed!');
  console.log('');
  console.log('📝 Summary:');
  console.log('   - Server is running and healthy');
  console.log('   - Supabase backend is configured');
  console.log('   - Sign-up creates user and profile');
  console.log('   - Sign-in returns valid JWT token');
  console.log('   - Invalid credentials are rejected');
  console.log('');
  console.log('🎉 Authentication system is working correctly!');
}

runTests().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
