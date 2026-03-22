require('dotenv').config({ path: './api/.env' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function diagnose() {
  console.log("Checking for tokens updated today (2026-03-22 - Note: server time might be slightly off)");
  const { data, error } = await supabaseAdmin
    .from('push_tokens')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Latest Tokens:", JSON.stringify(data, null, 2));
  }
}

diagnose();
