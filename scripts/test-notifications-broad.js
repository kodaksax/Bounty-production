require('dotenv').config({ path: './api/.env' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = global.fetch || require('node-fetch');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runBroadTest() {
  console.log("Fetching top 5 most recently active push tokens...");
  const { data: tokens, error: tokensErr } = await supabaseAdmin
      .from('push_tokens')
      .select('user_id, token, updated_at')
      .order('updated_at', { ascending: false })
      .limit(5);
      
  if (tokensErr || !tokens || tokens.length === 0) {
      console.error("No push tokens found.");
      process.exit(1);
  }

  console.log(`Found ${tokens.length} candidate tokens.`);

  for (const item of tokens) {
    const { user_id: userId, token, updated_at: updatedAt } = item;
    console.log(`--- Targeting User: ${userId} (Last updated: ${updatedAt}) ---`);

    // 1. In-App
    const { error: insErr } = await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'message',
      title: 'Broad Test Notification',
      body: 'Testing at ' + new Date().toLocaleTimeString(),
      data: { broadTest: true }
    });
    if (insErr) console.warn(`  ❌ In-app failed for ${userId}:`, insErr.message);
    else console.log(`  ✅ In-app created for ${userId}`);

    // 2. Push
    if (token) {
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: token,
            sound: 'default',
            title: 'Broad Test Push',
            body: 'Bounty: Testing multiple tokens... ' + new Date().toLocaleTimeString(),
          }),
        });
        const resData = await response.json();
        console.log(`  ✅ Expo response for ${userId}:`, resData.data?.status || JSON.stringify(resData));
      } catch (e) {
        console.warn(`  ❌ Push failed for ${userId}:`, e.message);
      }
    }
  }
}

runBroadTest().catch(e => console.error(e));
