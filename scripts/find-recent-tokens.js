require('dotenv').config({ path: './api/.env' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function findRecentTokens() {
  console.log("Checking for ANY tokens updated on 2026-03-21 or 2026-03-22...");
  const { data, error } = await supabaseAdmin
    .from('push_tokens')
    .select('*')
    .gt('updated_at', '2026-03-21T00:00:00Z')
    .order('updated_at', { ascending: false });
    
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Tokens found:", JSON.stringify(data, null, 2));
  }
}

findRecentTokens();
