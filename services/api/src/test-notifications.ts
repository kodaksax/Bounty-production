/**
 * Test script for notifications system
 * Run with: npx tsx services/api/src/test-notifications.ts
 */

import dotenv from 'dotenv';
import { db } from './db/connection';
import { users, notifications } from './db/schema';
import { notificationService } from './services/notification-service';
import { eq } from 'drizzle-orm';

dotenv.config();

async function testNotifications() {
  console.log('🧪 Testing Notifications System\n');

  try {
    // 1. Create a test user if not exists
    console.log('1. Setting up test user...');
    // Generate a test UUID with recognizable pattern: test-0000-xxxx-xxxx-xxxxxxxxxxxx
    const testUserId = '00000000-0000-4000-8000-000000000001'; // Valid UUID v4 test pattern
    
    let user = await db
      .select()
      .from(users)
      .where(eq(users.id, testUserId))
      .limit(1);

    if (user.length === 0) {
      console.log('   Creating test user...');
      const [newUser] = await db
        .insert(users)
        .values({
          id: testUserId,
          handle: 'test-user',
        })
        .returning();
      console.log('   ✓ Test user created:', newUser.handle);
    } else {
      console.log('   ✓ Test user exists:', user[0].handle);
    }

    // 2. Test creating a notification
    console.log('\n2. Creating test notifications...');
    
    const notif1 = await notificationService.createNotification({
      userId: testUserId,
      type: 'completion',
      title: 'Bounty Completed',
      body: 'Your bounty "Fix the login bug" has been completed!',
      data: { bountyId: 'test-bounty-123' },
    }, false); // Don't send push for test
    console.log('   ✓ Created completion notification:', notif1.id);

    const notif2 = await notificationService.createNotification({
      userId: testUserId,
      type: 'message',
      title: 'New Message',
      body: 'You have a new message from John Doe',
      data: { senderId: 'user-456' },
    }, false);
    console.log('   ✓ Created message notification:', notif2.id);

    const notif3 = await notificationService.createNotification({
      userId: testUserId,
      type: 'follow',
      title: 'New Follower',
      body: 'Jane Smith started following you',
      data: { followerId: 'user-789' },
    }, false);
    console.log('   ✓ Created follow notification:', notif3.id);

    // 3. Fetch notifications
    console.log('\n3. Fetching notifications...');
    const fetchedNotifications = await notificationService.getNotifications(testUserId, 10);
    console.log(`   ✓ Retrieved ${fetchedNotifications.length} notifications`);
    fetchedNotifications.forEach((n, i) => {
      console.log(`     ${i + 1}. [${n.type}] ${n.title} (read: ${n.read})`);
    });

    // 4. Get unread count
    console.log('\n4. Getting unread count...');
    const unreadCount = await notificationService.getUnreadCount(testUserId);
    console.log(`   ✓ Unread notifications: ${unreadCount}`);

    // 5. Mark one as read
    console.log('\n5. Marking first notification as read...');
    await notificationService.markAsRead([notif1.id]);
    const updatedCount = await notificationService.getUnreadCount(testUserId);
    console.log(`   ✓ Unread count after marking one read: ${updatedCount}`);

    // 6. Mark all as read
    console.log('\n6. Marking all notifications as read...');
    await notificationService.markAllAsRead(testUserId);
    const finalCount = await notificationService.getUnreadCount(testUserId);
    console.log(`   ✓ Final unread count: ${finalCount}`);

    // 7. Test helper methods
    console.log('\n7. Testing helper notification methods...');
    
    await notificationService.notifyBountyApplication(
      'hunter-123',
      testUserId,
      'bounty-456',
      'Build a mobile app'
    );
    console.log('   ✓ Created bounty application notification');

    await notificationService.notifyBountyAcceptance(
      'hunter-123',
      'bounty-456',
      'Build a mobile app'
    );
    console.log('   ✓ Created bounty acceptance notification');

    await notificationService.notifyPayment(
      testUserId,
      10000, // $100.00
      'bounty-789',
      'Design a logo'
    );
    console.log('   ✓ Created payment notification');

    // 8. Final summary
    console.log('\n8. Final notification summary...');
    const allNotifications = await notificationService.getNotifications(testUserId, 50);
    console.log(`   ✓ Total notifications for test user: ${allNotifications.length}`);
    
    const byType = allNotifications.reduce((acc, n) => {
      acc[n.type] = (acc[n.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('   Breakdown by type:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`     - ${type}: ${count}`);
    });

    console.log('\n✅ All tests passed!');
    console.log('\n📝 Note: Push notifications are disabled in test mode.');
    console.log('   To test push notifications, use a real device with registered token.\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run tests
testNotifications();
