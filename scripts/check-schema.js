require('dotenv').config({ path: './api/.env' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkSchema() {
  console.log("Checking for available tables in public schema...");
  // We can't query information_schema easily through Supabase JS without RPC, 
  // so we'll just try to select from the most likely names.
  
  const tables = ['notifications', 'push_tokens', 'notifications_outbox', 'notification_outbox', 'notification_queue'];
  
  for (const table of tables) {
    const { error } = await supabaseAdmin.from(table).select('*').limit(0);
    if (error) {
      console.log(`❌ ${table}: ${error.code} - ${error.message}`);
    } else {
      console.log(`✅ ${table}: Available`);
    }
  }
}

checkSchema();
