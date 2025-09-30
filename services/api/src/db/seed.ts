import { db } from './connection';
import { users, bounties } from './schema';

// Test user data
const testUsers = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    handle: '@test_user',
  },
  {
    id: '00000000-0000-0000-0000-000000000002', 
    handle: '@john_doe',
  },
];

async function seed() {
  try {
    console.log('🌱 Seeding database...');
    
    // Insert test users
    for (const user of testUsers) {
      await db.insert(users).values(user).onConflictDoNothing();
      console.log(`✅ Created user: ${user.handle}`);
    }
    
    console.log('🎉 Seeding completed successfully');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

// Run seed if this file is executed directly
if (require.main === module) {
  seed();
}

export { seed };
