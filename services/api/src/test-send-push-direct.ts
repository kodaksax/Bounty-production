/**
 * Direct Expo push sender (bypasses DB) for quick device delivery tests.
 * Usage:
 *  npx tsx services/api/src/test-send-push-direct.ts
 *
 * Environment variables:
 *  TEST_EXPO_TOKEN - Expo push token (required)
 */

import dotenv from 'dotenv';
import { Expo } from 'expo-server-sdk';
import fs from 'fs';
import path from 'path';

// Load environment variables (prefer .env.<NODE_ENV> then fallbacks)
{
  const envName = process.env.NODE_ENV ? `.env.${String(process.env.NODE_ENV).toLowerCase()}` : '.env';
  const serviceEnv = path.resolve(__dirname, '..', envName);
  if (fs.existsSync(serviceEnv)) {
    dotenv.config({ path: serviceEnv });
  } else {
    const rootEnv = path.resolve(process.cwd(), envName);
    if (fs.existsSync(rootEnv)) {
      dotenv.config({ path: rootEnv });
    } else {
      dotenv.config();
    }
  }
}

async function run() {
  const token = process.env.TEST_EXPO_TOKEN;
  if (!token) {
    console.error('ERROR: TEST_EXPO_TOKEN not set.');
    process.exit(1);
  }

  const expo = new Expo();
  if (!Expo.isExpoPushToken(token)) {
    console.error('ERROR: Provided token is not a valid Expo push token:', token);
    process.exit(1);
  }

  const message = {
    to: token,
    sound: 'default' as const,
    title: 'Test Push from BountyExpo',
    body: 'This is a direct push test. If you see this, pushes are working.',
    data: { test: true },
  };

  try {
    console.log('Sending direct push to', token);
    const tickets = await expo.sendPushNotificationsAsync([message]);
    console.log('Expo send result:', JSON.stringify(tickets, null, 2));
    console.log('✅ Direct push attempt completed. Check your device.');
  } catch (err) {
    console.error('❌ Error sending direct push:', err);
    process.exit(1);
  }

  process.exit(0);
}

run();
