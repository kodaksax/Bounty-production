require('dotenv').config({ path: './api/.env' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = global.fetch || require('node-fetch');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase credentials in environment.");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runTest() {
  console.log("Finding latest active push token to test...");
  const { data: tokens, error: tokensErr } = await supabaseAdmin
      .from('push_tokens')
      .select('user_id, token')
      .order('updated_at', { ascending: false })
      .limit(1);
      
  if (tokensErr || !tokens || tokens.length === 0) {
      console.error("No active push tokens found in the database.");
      process.exit(1);
  }
  const userId = tokens[0].user_id;
  const pushToken = tokens[0].token;
  console.log(`Found token for user_id: ${userId}`);
  console.log(`Token: ${pushToken}`);

  // 1. Create in-app notification with VALID type
  console.log(`Creating test in-app notification (type: message)...`);
  const notifPayload = {
      user_id: userId,
      type: 'message', // VALID TYPE
      title: 'Test In-App Notification',
      body: 'Verified at ' + new Date().toLocaleTimeString(),
      data: { test: true },
      read: false
  };
  
  const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('notifications')
      .insert([notifPayload])
      .select();
      
  if (insertErr) {
      console.error("Failed to insert notification:", insertErr);
  } else {
      console.log("✅ Successfully created in-app notification:", inserted[0]?.id);
  }

  // 2. Direct Push Delivery Test
  console.log(`Sending direct push notification to Expo...`);
  const message = {
    to: pushToken,
    sound: 'default',
    title: 'Test Push Notification',
    body: 'Bounty: Direct push test successful! ' + new Date().toLocaleTimeString(),
    data: { withSomeData: 'yes' },
  };

  try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });
      const resData = await response.json();
      console.log("✅ Expo response:", JSON.stringify(resData, null, 2));
      if (resData.data && resData.data[0] && resData.data[0].status === 'ok') {
          console.log("🚀 Push notification enqueued successfully by Expo!");
      } else {
          console.warn("⚠️  Push delivery might have failed. Check response.");
      }
  } catch (e) {
      console.error("Failed to send push:", e);
  }
}

runTest().catch(e => console.error(e));
