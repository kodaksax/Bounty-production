const fetch = require('node-fetch');

const API_BASE = 'http://127.0.0.1:3003/api';
const POSTER_ID = '93955dc0-b933-4c6f-bf3c-4e01493169c0';
const HUNTER_ID = 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';

async function testTriggers() {
  let bountyId;

  console.log('--- Step 1: Create Bounty ---');
  try {
    const resp = await fetch(`${API_BASE}/bounties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Notification Test Bounty',
        description: 'Testing multiple triggers',
        amount: 50,
        poster_id: POSTER_ID,
        username: '@poster007'
      })
    });
    const data = await resp.json();
    bountyId = data.id;
    console.log('Bounty Created:', bountyId);
  } catch (e) {
    console.error('Bounty Creation Failed:', e.message);
    return;
  }

  console.log('\n--- Step 2: Accept Bounty (Signal Begin Work) ---');
  try {
    // We use the bounty-requests flow since I implemented it there too.
    const applyResp = await fetch(`${API_BASE}/bounty-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            bounty_id: bountyId,
            hunter_id: HUNTER_ID,
            status: 'pending',
            message: 'I want this'
        })
    });
    const applyData = await applyResp.json();
    const requestId = applyData.id;

    const acceptResp = await fetch(`${API_BASE}/bounty-requests/${requestId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const acceptData = await acceptResp.json();
    console.log('Acceptance Response (Notifies Hunter):', JSON.stringify(acceptData, null, 2));
  } catch (e) {
    console.error('Acceptance Test Failed:', e.message);
  }

  console.log('\n--- Step 3: Complete Bounty (Review Needed) ---');
  try {
    const completeResp = await fetch(`${API_BASE}/bounties/${bountyId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const completeData = await completeResp.json();
    console.log('Completion Response (Notifies Poster):', JSON.stringify(completeData, null, 2));
  } catch (e) {
    console.error('Completion Test Failed:', e.message);
  }

  console.log('\n--- Step 4: Status Update (PATCH) ---');
  try {
    const updateResp = await fetch(`${API_BASE}/bounties/${bountyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' })
    });
    const updateData = await updateResp.json();
    console.log('Update Response (Notifies Hunter):', JSON.stringify(updateData, null, 2));
  } catch (e) {
    console.error('Update Test Failed:', e.message);
  }
}

testTriggers();
