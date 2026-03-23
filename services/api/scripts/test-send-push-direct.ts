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

import { Expo } from 'expo-server-sdk';

async function run() {
  const token = process.env.TEST_EXPO_TOKEN;
  if (!token) {
    console.error('ERROR: TEST_EXPO_TOKEN must be set');
    process.exit(1);
  }

  const expo = new Expo();
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
    console.log('✅ Direct push attempt completed.');
  } catch (err) {
    console.error('❌ Error sending direct push:', err);
    process.exit(1);
  }

  process.exit(0);
}

if (require.main === module) run().catch(err => { console.error(err); process.exit(1); });
