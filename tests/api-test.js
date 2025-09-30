const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3001/api';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testHealthCheck() {
  console.log('🔍 Testing health check...');
  const response = await fetch('http://localhost:3001/health');
  const data = await response.json();
  
  if (response.ok && data.status === 'ok') {
    console.log('✅ Health check passed');
    return true;
  } else {
    console.log('❌ Health check failed');
    return false;
  }
}

async function testCreateBounty() {
  console.log('🔍 Testing bounty creation...');
  
  const bountyData = {
    title: 'Test bounty creation',
    description: 'This is a test bounty to validate the API endpoint with proper validation',
    amount: 50,
    is_for_honor: false,
    location: 'Test Location',
    user_id: '00000000-0000-0000-0000-000000000001',
    work_type: 'online'
  };

  const response = await fetch(`${API_BASE}/bounties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bountyData)
  });

  const data = await response.json();
  
  if (response.status === 201 && data.id) {
    console.log('✅ Bounty created successfully:', data.id);
    return data;
  } else {
    console.log('❌ Failed to create bounty:', response.status, data);
    return null;
  }
}

async function testCreateInvalidBounty() {
  console.log('🔍 Testing invalid bounty creation (should fail)...');
  
  const bountyData = {
    title: 'Short', // Too short
    description: 'Also too short', // Too short
    amount: -10, // Negative
    user_id: 'not-a-uuid', // Invalid UUID
  };

  const response = await fetch(`${API_BASE}/bounties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bountyData)
  });

  const data = await response.json();
  
  if (response.status === 400 && data.error === 'Validation failed') {
    console.log('✅ Invalid bounty correctly rejected');
    return true;
  } else {
    console.log('❌ Invalid bounty should have been rejected:', response.status, data);
    return false;
  }
}

async function testGetBounties() {
  console.log('🔍 Testing get bounties...');
  
  const response = await fetch(`${API_BASE}/bounties`);
  const data = await response.json();
  
  if (response.ok && Array.isArray(data)) {
    console.log(`✅ Got ${data.length} bounties`);
    return data;
  } else {
    console.log('❌ Failed to get bounties:', response.status, data);
    return [];
  }
}

async function testGetBountiesWithStatusFilter() {
  console.log('🔍 Testing get bounties with status filter...');
  
  const response = await fetch(`${API_BASE}/bounties?status=open`);
  const data = await response.json();
  
  if (response.ok && Array.isArray(data)) {
    console.log(`✅ Got ${data.length} open bounties`);
    return data;
  } else {
    console.log('❌ Failed to get bounties with filter:', response.status, data);
    return [];
  }
}

async function testInvalidStatusFilter() {
  console.log('🔍 Testing invalid status filter (should fail)...');
  
  const response = await fetch(`${API_BASE}/bounties?status=invalid_status`);
  const data = await response.json();
  
  if (response.status === 400 && data.error === 'Invalid query parameters') {
    console.log('✅ Invalid status filter correctly rejected');
    return true;
  } else {
    console.log('❌ Invalid status filter should have been rejected:', response.status, data);
    return false;
  }
}

async function testBountyTransitions(bountyId) {
  console.log(`🔍 Testing bounty transitions for bounty ${bountyId}...`);

  // Test accept transition (open -> in_progress)
  console.log('  Testing accept transition...');
  let response = await fetch(`${API_BASE}/bounties/${bountyId}/accept`, {
    method: 'POST'
  });
  let data = await response.json();
  
  if (response.ok && data.success && data.newStatus === 'in_progress') {
    console.log('  ✅ Accept transition successful');
  } else {
    console.log('  ❌ Accept transition failed:', response.status, data);
    return false;
  }

  // Test invalid transition (in_progress -> accept should fail)
  console.log('  Testing invalid accept transition (should fail)...');
  response = await fetch(`${API_BASE}/bounties/${bountyId}/accept`, {
    method: 'POST'
  });
  data = await response.json();
  
  if (response.status === 409 && data.error === 'Invalid state transition') {
    console.log('  ✅ Invalid accept transition correctly rejected');
  } else {
    console.log('  ❌ Invalid accept transition should have been rejected:', response.status, data);
    return false;
  }

  // Test complete transition (in_progress -> completed)
  console.log('  Testing complete transition...');
  response = await fetch(`${API_BASE}/bounties/${bountyId}/complete`, {
    method: 'POST'
  });
  data = await response.json();
  
  if (response.ok && data.success && data.newStatus === 'completed') {
    console.log('  ✅ Complete transition successful');
  } else {
    console.log('  ❌ Complete transition failed:', response.status, data);
    return false;
  }

  // Test archive transition (completed -> archived)
  console.log('  Testing archive transition...');
  response = await fetch(`${API_BASE}/bounties/${bountyId}/archive`, {
    method: 'POST'
  });
  data = await response.json();
  
  if (response.ok && data.success && data.newStatus === 'archived') {
    console.log('  ✅ Archive transition successful');
  } else {
    console.log('  ❌ Archive transition failed:', response.status, data);
    return false;
  }

  // Test invalid transition from archived (should fail)
  console.log('  Testing invalid transition from archived (should fail)...');
  response = await fetch(`${API_BASE}/bounties/${bountyId}/accept`, {
    method: 'POST'
  });
  data = await response.json();
  
  if (response.status === 409 && data.error === 'Invalid state transition') {
    console.log('  ✅ Invalid transition from archived correctly rejected');
    return true;
  } else {
    console.log('  ❌ Invalid transition from archived should have been rejected:', response.status, data);
    return false;
  }
}

async function testNonExistentBountyTransition() {
  console.log('🔍 Testing transition on non-existent bounty...');
  
  const response = await fetch(`${API_BASE}/bounties/99999/accept`, {
    method: 'POST'
  });
  const data = await response.json();
  
  if (response.status === 404 && data.error === 'Bounty not found') {
    console.log('✅ Non-existent bounty correctly handled');
    return true;
  } else {
    console.log('❌ Non-existent bounty should return 404:', response.status, data);
    return false;
  }
}

async function runAllTests() {
  console.log('🧪 Running API integration tests...\n');

  // Wait for server to start
  await sleep(2000);

  let passed = 0;
  let total = 0;

  const tests = [
    testHealthCheck,
    testCreateInvalidBounty,
    testInvalidStatusFilter,
    testNonExistentBountyTransition,
  ];

  // Run individual tests
  for (const test of tests) {
    total++;
    try {
      const result = await test();
      if (result) passed++;
    } catch (error) {
      console.log(`❌ Test ${test.name} threw error:`, error.message);
    }
    console.log(''); // Add spacing
  }

  // Test with actual bounty creation and transitions
  total++;
  try {
    const bounty = await testCreateBounty();
    if (bounty) {
      const bounties = await testGetBounties();
      const filteredBounties = await testGetBountiesWithStatusFilter();
      const transitionsOk = await testBountyTransitions(bounty.id);
      
      if (bounties && filteredBounties && transitionsOk) {
        passed++;
        console.log('✅ Full bounty workflow test passed');
      } else {
        console.log('❌ Full bounty workflow test failed');
      }
    } else {
      console.log('❌ Could not create bounty for workflow test');
    }
  } catch (error) {
    console.log('❌ Bounty workflow test threw error:', error.message);
  }

  console.log(`\n📊 API Test Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All API tests passed!');
    process.exit(0);
  } else {
    console.log('💥 Some API tests failed');
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests };