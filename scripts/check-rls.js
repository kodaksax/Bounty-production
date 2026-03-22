require('dotenv').config({ path: './api/.env' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkPolicies() {
  console.log("Checking RLS policies for push_tokens...");
  // Query pg_policies via RPC or just check if we can insert/select as a user.
  // Since we can't easily query pg_policies without a custom function, 
  // let's try to find if there's a migration that actually applied them.
  
  const { data, error } = await supabaseAdmin.rpc('get_policies', { table_name: 'push_tokens' });
  if (error) {
    console.log("RPC 'get_policies' not found. Trying raw query if possible (likely not).");
  } else {
    console.log("Policies:", JSON.stringify(data, null, 2));
  }
  
  // Alternative: Check the result of a mock insert with a test user ID.
  console.log("Testing permission for a mock user ID...");
  const testUserId = 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  const { error: upsertErr } = await supabaseAdmin
    .from('push_tokens')
    .upsert({ user_id: testUserId, token: 'test-token-' + Date.now() }, { onConflict: 'token' });
    
  if (upsertErr) {
    console.log("Upsert as Admin failed (unlikely for admin):", upsertErr);
  } else {
    console.log("Upsert as Admin succeeded. Checking if it matches the schema.");
  }
}

checkPolicies();
