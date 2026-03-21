require('dotenv').config({ path: './api/.env' }); // try api/.env first
require('dotenv').config(); // try root .env
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase credentials in environment.");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function runTest(usernameOrEmail) {
  console.log(`Starting test for user: ${usernameOrEmail}`);
  
  // 1. Find user profile
  let userId;
  
  // If no username provided, we just send to the most recently registered push token
  if (!usernameOrEmail) {
      console.log("No username provided. Finding latest active push token to test...");
      const { data: tokens, error: tokensErr } = await supabaseAdmin
          .from('push_tokens')
          .select('profile_id, token')
          .order('updated_at', { ascending: false })
          .limit(1);
          
      if (tokensErr || !tokens || tokens.length === 0) {
          console.error("No active push tokens found in the database. Please launch the app on your device and log in first.");
          process.exit(1);
      }
      userId = tokens[0].profile_id;
      console.log(`Found recent token for profile_id: ${userId}`);
  } else {
    // Implement finding by username logic here if needed (depends on db connection)
    // For now we assume we just test the latest token
    console.log("Currently only testing latest token is supported without direct DB access.");
    process.exit(1);
  }

  // 2. We have the user ID. Now we trigger a notification.
  // Instead of direct push, let's insert into notifications table and let realtime / outbox do its job, 
  // or insert into notifications_outbox if that's how it routes.
  // Let's create an in-app notification first:
  console.log(`Creating test in-app notification for ${userId}...`);
  const notifPayload = {
      user_id: userId,
      type: 'system',
      title: 'Test In-App Notification',
      body: 'This is a test to verify notifications are working! ' + new Date().toLocaleTimeString(),
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

  // 3. Now let's enqueue into notifications_outbox for a push notification
  console.log(`Enqueuing push notification to outbox...`);
  const outboxPayload = {
      recipients: [userId],
      title: 'Test Push Notification',
      body: 'Testing push delivery via edge function. ' + new Date().toLocaleTimeString(),
      data: { test: true }
  };
  
  const { data: outboxInserted, error: outboxErr } = await supabaseAdmin
      .from('notifications_outbox')
      .insert([outboxPayload])
      .select('id')
      .single();
      
  if (outboxErr) {
      console.error("Failed to enqueue outbox:", outboxErr);
  } else {
      console.log("✅ Successfully enqueued push notification (outbox id: " + outboxInserted.id + ")");
      console.log("If your edge functions are running, the push should be delivered momentarily.");
  }
}

const arg = process.argv[2];
runTest(arg).catch(e => console.error(e));
