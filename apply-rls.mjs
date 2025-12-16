#!/usr/bin/env node
/**
 * Apply RLS policies to Supabase notification tables
 * Usage: node apply-rls.js
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment variables');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const sqlStatements = `
-- Enable RLS on notifications table
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- Notifications: Users can only SELECT/INSERT/UPDATE their own notifications
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own" ON public.notifications
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable RLS on push_tokens table
ALTER TABLE IF EXISTS public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Push tokens: Users can only SELECT/INSERT/UPDATE/DELETE their own tokens
DROP POLICY IF EXISTS "push_tokens_select_own" ON public.push_tokens;
CREATE POLICY "push_tokens_select_own" ON public.push_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_insert_own" ON public.push_tokens;
CREATE POLICY "push_tokens_insert_own" ON public.push_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_update_own" ON public.push_tokens;
CREATE POLICY "push_tokens_update_own" ON public.push_tokens
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_delete_own" ON public.push_tokens;
CREATE POLICY "push_tokens_delete_own" ON public.push_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Enable RLS on notification_preferences table
ALTER TABLE IF EXISTS public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Notification preferences: Users can only SELECT/INSERT/UPDATE their own preferences
DROP POLICY IF EXISTS "notification_preferences_select_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_select_own" ON public.notification_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_preferences_insert_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_insert_own" ON public.notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_preferences_update_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_update_own" ON public.notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
`;

async function applyRLS() {
  const client = await pool.connect();

  try {
    console.log('🔐 Applying RLS policies to Supabase notification tables...\n');

    // Split statements and execute each one
    const statements = sqlStatements
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let successCount = 0;
    for (const statement of statements) {
      try {
        await client.query(statement);
        successCount++;
        const shortStatement = statement.replace(/\n/g, ' ').substring(0, 70);
        console.log(`✓ ${shortStatement}...`);
      } catch (error) {
        // Some statements might fail if they don't exist (e.g., DROP POLICY on non-existent policy)
        // This is expected and not an error
        if (!error.message.includes('does not exist')) {
          throw error;
        }
      }
    }

    console.log(`\n✅ RLS policies applied successfully (${successCount}/${statements.length} statements)!\n`);
    console.log('Summary:');
    console.log('  • Enabled RLS on notifications table');
    console.log('  • Enabled RLS on push_tokens table');
    console.log('  • Enabled RLS on notification_preferences table');
    console.log('\nPolicies allow users to:');
    console.log('  • View/modify only their own notifications');
    console.log('  • View/modify/delete only their own push tokens');
    console.log('  • View/modify only their own notification preferences');
  } catch (error) {
    console.error('❌ Error applying RLS policies:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

applyRLS();
