/**
 * Test script for search and filtering functionality
 * 
 * Tests:
 * 1. Bounty search with filters
 * 2. User search
 * 3. Recent searches service
 */

import { bountyService } from '../lib/services/bounty-service';
import { userSearchService } from '../lib/services/user-search-service';
import { recentSearchService } from '../lib/services/recent-search-service';

async function testBountySearch() {
  console.log('\n🔍 Testing Bounty Search...');
  
  try {
    // Test basic keyword search
    console.log('  - Testing keyword search...');
    const results = await bountyService.searchWithFilters({
      keywords: 'test',
      limit: 5,
    });
    console.log(`    ✓ Found ${results.length} bounties`);
    
    // Test with filters
    console.log('  - Testing with amount filter...');
    const filteredResults = await bountyService.searchWithFilters({
      keywords: 'design',
      minAmount: 50,
      maxAmount: 500,
      sortBy: 'amount_desc',
      limit: 5,
    });
    console.log(`    ✓ Found ${filteredResults.length} bounties with amount filter`);
    
    // Test status filter
    console.log('  - Testing status filter...');
    const openResults = await bountyService.searchWithFilters({
      status: ['open'],
      limit: 10,
    });
    console.log(`    ✓ Found ${openResults.length} open bounties`);
    
    console.log('  ✅ Bounty search tests passed');
    return true;
  } catch (error) {
    console.error('  ❌ Bounty search tests failed:', error);
    return false;
  }
}

async function testUserSearch() {
  console.log('\n👤 Testing User Search...');
  
  try {
    // Test user search
    console.log('  - Testing user keyword search...');
    const results = await userSearchService.searchUsers({
      keywords: 'user',
      limit: 5,
    });
    console.log(`    ✓ Found ${results.total} users`);
    console.log(`    ✓ Returned ${results.results.length} results`);
    
    // Test user suggestions
    console.log('  - Testing user suggestions...');
    const suggestions = await userSearchService.getUserSuggestions('test', 3);
    console.log(`    ✓ Got ${suggestions.length} suggestions`);
    
    console.log('  ✅ User search tests passed');
    return true;
  } catch (error) {
    console.error('  ❌ User search tests failed:', error);
    return false;
  }
}

async function testRecentSearches() {
  console.log('\n📝 Testing Recent Searches...');
  
  try {
    // Clear any existing searches
    await recentSearchService.clearAll();
    console.log('  - Cleared existing searches');
    
    // Save a bounty search
    await recentSearchService.saveSearch('bounty', 'web development', {
      minAmount: 100,
      sortBy: 'date_desc',
    });
    console.log('  ✓ Saved bounty search');
    
    // Save a user search
    await recentSearchService.saveSearch('user', 'john doe');
    console.log('  ✓ Saved user search');
    
    // Get all recent searches
    const allSearches = await recentSearchService.getRecentSearches();
    console.log(`  ✓ Retrieved ${allSearches.length} recent searches`);
    
    if (allSearches.length !== 2) {
      throw new Error(`Expected 2 searches, got ${allSearches.length}`);
    }
    
    // Get by type
    const bountySearches = await recentSearchService.getRecentSearchesByType('bounty');
    console.log(`  ✓ Retrieved ${bountySearches.length} bounty searches`);
    
    const userSearches = await recentSearchService.getRecentSearchesByType('user');
    console.log(`  ✓ Retrieved ${userSearches.length} user searches`);
    
    // Test duplicate prevention
    await recentSearchService.saveSearch('bounty', 'web development', {
      minAmount: 200,
    });
    const afterDuplicate = await recentSearchService.getRecentSearches();
    if (afterDuplicate.length !== 2) {
      throw new Error(`Expected duplicate prevention, got ${afterDuplicate.length} searches`);
    }
    console.log('  ✓ Duplicate prevention works');
    
    // Remove a search
    if (allSearches[0]) {
      await recentSearchService.removeSearch(allSearches[0].id);
      console.log('  ✓ Removed a search');
    }
    
    const afterRemoval = await recentSearchService.getRecentSearches();
    console.log(`  ✓ ${afterRemoval.length} searches remaining`);
    
    // Clear all
    await recentSearchService.clearAll();
    const afterClear = await recentSearchService.getRecentSearches();
    if (afterClear.length !== 0) {
      throw new Error(`Expected 0 searches after clear, got ${afterClear.length}`);
    }
    console.log('  ✓ Clear all works');
    
    console.log('  ✅ Recent searches tests passed');
    return true;
  } catch (error) {
    console.error('  ❌ Recent searches tests failed:', error);
    return false;
  }
}

async function runAllTests() {
  console.log('🧪 Running Search and Filtering Tests\n');
  console.log('=' .repeat(50));
  
  const results = {
    bountySearch: await testBountySearch(),
    userSearch: await testUserSearch(),
    recentSearches: await testRecentSearches(),
  };
  
  console.log('\n' + '='.repeat(50));
  console.log('\n📊 Test Results Summary:');
  console.log(`  Bounty Search: ${results.bountySearch ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  User Search: ${results.userSearch ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Recent Searches: ${results.recentSearches ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = Object.values(results).every(r => r);
  console.log(`\n${allPassed ? '✅ All tests passed!' : '❌ Some tests failed'}\n`);
  
  return allPassed;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runAllTests, testBountySearch, testUserSearch, testRecentSearches };
