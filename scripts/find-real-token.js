require('dotenv').config({ path: './api/.env' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function findRealToken() {
  const userId = 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  console.log(`Searching for real tokens for user ${userId}...`);
  const { data, error } = await supabaseAdmin
    .from('push_tokens')
    .select('*')
    .eq('user_id', userId)
    .ilike('token', 'ExponentPushToken[%')
    .order('updated_at', { ascending: false });
    
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Real Tokens found:", JSON.stringify(data, null, 2));
  }
}

findRealToken();
