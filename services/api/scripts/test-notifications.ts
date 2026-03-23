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

import { db } from '../src/db';
import { users } from '../src/db/schema';
import { notificationService } from '../src/services/notification-service';

async function run() {
  const testUserId = process.env.TEST_USER_ID || 'test-user-123';

  try {
    console.log('Ensuring test user exists...');
    const existing = await db.select().from(users).where(users.id.eq(testUserId)).limit(1);
    if ((existing as any[]).length === 0) {
      await db.insert(users).values({ id: testUserId, handle: 'test-user' });
      console.log('Created test user');
    } else {
      console.log('Test user exists');
    }

    console.log('Creating notifications (no push)');
    const n = await notificationService.createNotification({
      userId: testUserId,
      type: 'message',
      title: 'Test notification',
      body: 'This is a test',
      data: {},
    }, false);
    console.log('Created notification id:', n.id);

    console.log('Listing notifications');
    const items = await notificationService.getNotifications(testUserId, 10);
    console.log('Found', items.length);

    console.log('Done');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

if (require.main === module) run().catch(err => { console.error(err); process.exit(1); });
