/**
 * Send a test push notification via the API notification service
 * Usage:
 *  npx tsx services/api/src/test-send-push.ts
 *
 * Set environment variables to target a real device:
 *  TEST_HUNTER_ID - uuid of the hunter user to notify
 *  TEST_EXPO_TOKEN - Expo push token for the device (e.g. ExpoPushToken[xxxxxxxxxxxx])
 */

import dotenv from 'dotenv';
import { notificationService } from './services/notification-service';

dotenv.config();

async function run() {
  const hunterId = process.env.TEST_HUNTER_ID || '00000000-0000-4000-8000-000000000002';
  const token = process.env.TEST_EXPO_TOKEN;
  const deviceId = process.env.TEST_DEVICE_ID || 'test-device-1';
  const bountyId = process.env.TEST_BOUNTY_ID || 'test-bounty-001';
  const bountyTitle = process.env.TEST_BOUNTY_TITLE || 'Test Bounty for Push';

  console.log('🧪 Test push sender starting');
  console.log('Target hunterId:', hunterId);

  if (!token) {
    console.error('ERROR: TEST_EXPO_TOKEN not set in environment. Set this to your device Expo push token to test delivery.');
    process.exit(1);
  }

  try {
    console.log('Registering push token for user...');
    await notificationService.registerPushToken(hunterId, token, deviceId);
    console.log('Triggering acceptance notification (this will attempt to send push)...');
    await notificationService.notifyBountyAcceptance(hunterId, bountyId, bountyTitle);
    console.log('✅ Notification triggered. Check device and server logs for delivery status.');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }

  process.exit(0);
}

run();
