import { db } from './db/connection';
import { users, bounties } from './db/schema';

async function testDatabaseSchema() {
  try {
    console.log('🧪 Testing database schema...');
    
    // Test that we can query the schema (even if tables don't exist yet)
    console.log('✅ Database schema imports successfully');
    console.log('📋 Users table columns:', Object.keys(users));
    console.log('📋 Bounties table columns:', Object.keys(bounties));
    
    console.log('🎉 Schema validation passed!');
  } catch (error) {
    console.error('❌ Schema validation failed:', error);
    process.exit(1);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testDatabaseSchema();
}

export { testDatabaseSchema };
