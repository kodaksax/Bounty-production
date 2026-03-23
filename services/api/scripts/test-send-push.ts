import path from 'path';
// Load environment
try {
  const loadEnvPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'load-env.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const loadEnvMod = require(loadEnvPath);
  if (loadEnvMod && typeof loadEnvMod.loadEnv === 'function') {
    loadEnvMod.loadEnv(path.resolve(__dirname, '..', '..'));
  }
} catch (err) {
  // ignore
}

import { notificationService } from '../src/services/notification-service';

async function run() {
  const hunterId = process.env.TEST_HUNTER_ID;
  const token = process.env.TEST_EXPO_TOKEN;
  const deviceId = process.env.TEST_DEVICE_ID || 'test-device-1';
  const bountyId = process.env.TEST_BOUNTY_ID || 'test-bounty-123';
  const bountyTitle = process.env.TEST_BOUNTY_TITLE || 'Test Bounty Title';

  if (!hunterId || !token) {
    console.error('ERROR: TEST_HUNTER_ID and TEST_EXPO_TOKEN must be set to run this script');
    process.exit(1);
  }

  try {
    console.log('Registering push token for user...');
    await notificationService.registerPushToken(hunterId, token, deviceId);

    console.log('Triggering acceptance notification (attempting push delivery)...');
    await notificationService.notifyBountyAcceptance(hunterId, bountyId, bountyTitle);

    console.log('✅ Notification triggered. Check device and server logs for delivery status.');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }

  process.exit(0);
}

if (require.main === module) run().catch(err => { console.error(err); process.exit(1); });
