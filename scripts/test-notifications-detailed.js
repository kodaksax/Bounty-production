require('dotenv').config({ path: './api/.env' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = global.fetch || require('node-fetch');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runDetailedTest() {
  const userId = 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  const { data: tokens, error: tokensErr } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1);
      
  if (tokensErr || !tokens || tokens.length === 0) {
      console.error("No token found for user.");
      process.exit(1);
  }

  const pushToken = tokens[0].token;
  console.log(`Targeting Token: ${pushToken}`);

  console.log(`Sending detailed push request...`);
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: pushToken,
      title: 'Detailed Test',
      body: 'Testing at ' + new Date().toLocaleTimeString(),
    }),
  });
  
  const resData = await response.json();
  console.log("Full Expo Response:", JSON.stringify(resData, null, 2));
}

runDetailedTest().catch(e => console.error(e));
