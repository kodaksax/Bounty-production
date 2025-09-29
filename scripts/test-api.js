#!/usr/bin/env node

// Simple test script to validate API endpoints
const API_BASE = 'http://localhost:3001';

async function testAPI() {
  console.log('🧪 Starting API tests...\n');

  try {
    // Test 1: Health check
    console.log('1️⃣  Testing health endpoint...');
    const healthRes = await fetch(`${API_BASE}/health`);
    if (healthRes.ok) {
      const health = await healthRes.json();
      console.log('✅ Health check passed:', health.status);
    } else {
      console.log('❌ Health check failed');
      return;
    }

    // Test 2: Get current profile  
    console.log('\n2️⃣  Testing profile endpoint...');
    const profileRes = await fetch(`${API_BASE}/api/profile`);
    if (profileRes.ok) {
      const profile = await profileRes.json();
      console.log('✅ Profile retrieved:', profile.username);
    } else {
      console.log('❌ Profile retrieval failed');
    }

    // Test 3: Get all bounties
    console.log('\n3️⃣  Testing bounties endpoint...');
    const bountiesRes = await fetch(`${API_BASE}/api/bounties`);
    if (bountiesRes.ok) {
      const bounties = await bountiesRes.json();
      console.log(`✅ Bounties retrieved: ${bounties.length} bounties found`);
    } else {
      console.log('❌ Bounties retrieval failed');
    }

    // Test 4: Create a test bounty
    console.log('\n4️⃣  Testing bounty creation...');
    const testBounty = {
      title: "Test Bounty from API Test",
      description: "This is a test bounty created by the API test script",
      amount: 25.00,
      is_for_honor: false,
      location: "Test Location",
      timeline: "1 week",
      skills_required: "Testing",
      user_id: "00000000-0000-0000-0000-000000000001",
      work_type: "online"
    };

    const createRes = await fetch(`${API_BASE}/api/bounties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testBounty)
    });

    if (createRes.ok) {
      const newBounty = await createRes.json();
      console.log(`✅ Bounty created successfully: ID ${newBounty.id}`);
      
      // Test 5: Update the bounty we just created
      console.log('\n5️⃣  Testing bounty update...');
      const updateRes = await fetch(`${API_BASE}/api/bounties/${newBounty.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 30.00 })
      });

      if (updateRes.ok) {
        const updatedBounty = await updateRes.json();
        console.log(`✅ Bounty updated successfully: Amount now ${updatedBounty.amount}`);
      } else {
        console.log('❌ Bounty update failed');
      }

      // Clean up - delete the test bounty
      console.log('\n🧹 Cleaning up test bounty...');
      const deleteRes = await fetch(`${API_BASE}/api/bounties/${newBounty.id}`, {
        method: 'DELETE'
      });

      if (deleteRes.ok) {
        console.log('✅ Test bounty deleted successfully');
      } else {
        console.log('❌ Failed to delete test bounty');
      }
    } else {
      const error = await createRes.text();
      console.log('❌ Bounty creation failed:', error);
    }

    console.log('\n🎉 API tests completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.log('\n💡 Make sure the API server is running with: node api/server.js');
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  testAPI();
}

module.exports = { testAPI };