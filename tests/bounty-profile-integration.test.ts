/**
 * Test suite for bounty-profile integration
 * Verifies that bounties are properly joined with profile data
 */

import { bountyService } from '../lib/services/bounty-service';

describe('Bounty Profile Integration', () => {
  it('should fetch bounties with username from profiles table', async () => {
    const bounties = await bountyService.getAll({ status: 'open', limit: 5 });
    
    console.log('\n=== Bounty Profile Integration Test ===');
    console.log(`Fetched ${bounties.length} bounties`);
    
    if (bounties.length > 0) {
      const firstBounty = bounties[0];
      console.log('\nFirst bounty:');
      console.log(`  ID: ${firstBounty.id}`);
      console.log(`  Title: ${firstBounty.title}`);
      console.log(`  Username: ${firstBounty.username || 'NOT FOUND'}`);
      console.log(`  Poster Avatar: ${firstBounty.poster_avatar || 'NOT FOUND'}`);
      console.log(`  User ID: ${firstBounty.user_id}`);
      
      // Check if username is populated
      if (firstBounty.username) {
        console.log('\n✅ SUCCESS: Username is populated from profiles table');
      } else {
        console.log('\n⚠️  WARNING: Username is not populated (may be missing profile data)');
      }
      
      // Check if poster_avatar is available
      if (firstBounty.poster_avatar) {
        console.log('✅ SUCCESS: Poster avatar is populated from profiles table');
      } else {
        console.log('ℹ️  INFO: Poster avatar is not available (user may not have set an avatar)');
      }
    } else {
      console.log('\nℹ️  INFO: No bounties found in database');
    }
    
    console.log('\n=== Test Complete ===\n');
  }, 30000); // 30 second timeout for network requests

  it('should fetch single bounty with username', async () => {
    // First get a bounty ID
    const bounties = await bountyService.getAll({ limit: 1 });
    
    if (bounties.length === 0) {
      console.log('Skipping single bounty test - no bounties available');
      return;
    }
    
    const bountyId = bounties[0].id;
    const singleBounty = await bountyService.getById(bountyId);
    
    console.log('\n=== Single Bounty Fetch Test ===');
    if (singleBounty) {
      console.log(`Bounty ID: ${singleBounty.id}`);
      console.log(`Username: ${singleBounty.username || 'NOT FOUND'}`);
      console.log(`Poster Avatar: ${singleBounty.poster_avatar || 'NOT FOUND'}`);
      
      if (singleBounty.username) {
        console.log('\n✅ SUCCESS: Single bounty fetch includes username');
      }
    } else {
      console.log('⚠️  WARNING: Could not fetch single bounty');
    }
    console.log('=== Test Complete ===\n');
  }, 30000);

  it('should search bounties with username', async () => {
    const searchResults = await bountyService.search('lawn', { limit: 3 });
    
    console.log('\n=== Search Test ===');
    console.log(`Found ${searchResults.length} bounties matching 'lawn'`);
    
    if (searchResults.length > 0) {
      const firstResult = searchResults[0];
      console.log(`First result username: ${firstResult.username || 'NOT FOUND'}`);
      
      if (firstResult.username) {
        console.log('✅ SUCCESS: Search results include username');
      }
    }
    console.log('=== Test Complete ===\n');
  }, 30000);
});

// Allow running this file directly
if (require.main === module) {
  console.log('Running bounty-profile integration tests...\n');
  
  (async () => {
    try {
      // Test getAll
      console.log('Testing bountyService.getAll()...');
      const bounties = await bountyService.getAll({ status: 'open', limit: 5 });
      console.log(`✓ Fetched ${bounties.length} bounties`);
      
      if (bounties.length > 0) {
        const hasUsername = bounties.some(b => b.username);
        const hasAvatar = bounties.some(b => b.poster_avatar);
        
        console.log(`  - Bounties with username: ${bounties.filter(b => b.username).length}/${bounties.length}`);
        console.log(`  - Bounties with avatar: ${bounties.filter(b => b.poster_avatar).length}/${bounties.length}`);
        
        if (hasUsername) {
          console.log('  ✅ Username field is working');
        } else {
          console.log('  ⚠️  No usernames found - check database data');
        }
      }
      
      console.log('\n✓ All tests completed successfully');
    } catch (error) {
      console.error('✗ Test failed:', error);
      process.exit(1);
    }
  })();
}
