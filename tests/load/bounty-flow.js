/**
 * k6 Load Test - Bounty Flow
 * 
 * Tests the core bounty listing and viewing flows under various load conditions.
 * This script simulates realistic user behavior: browsing bounties, viewing details,
 * and searching for specific bounties.
 * 
 * Usage:
 *   k6 run tests/load/bounty-flow.js
 *   k6 run --vus 50 --duration 5m tests/load/bounty-flow.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const listBountiesDuration = new Trend('list_bounties_duration');
const getBountyDuration = new Trend('get_bounty_duration');
const searchBountiesDuration = new Trend('search_bounties_duration');

// Test configuration
export let options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp up to 200 users
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '2m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],        // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],          // Error rate < 1%
    errors: ['rate<0.05'],                   // Custom error rate < 5%
    list_bounties_duration: ['p(95)<500'],   // List bounties p95 < 500ms
    get_bounty_duration: ['p(95)<200'],      // Get single bounty p95 < 200ms
    search_bounties_duration: ['p(95)<1000'], // Search p95 < 1000ms
  },
};

// Base URL - can be overridden with -e BASE_URL=...
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

/**
 * Main test scenario executed by each virtual user
 */
export default function () {
  // Scenario 1: List bounties (most common operation)
  let response = http.get(`${BASE_URL}/bounties?status=open&limit=20`, {
    tags: { name: 'ListBounties' },
  });
  
  const listSuccess = check(response, {
    'list bounties status 200': (r) => r.status === 200,
    'list bounties < 500ms': (r) => r.timings.duration < 500,
    'list bounties has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.bounties && Array.isArray(body.bounties);
      } catch (e) {
        return false;
      }
    },
  });
  
  if (!listSuccess) {
    errorRate.add(1);
  } else {
    listBountiesDuration.add(response.timings.duration);
  }
  
  // Simulate user reading the list
  sleep(1);

  // Scenario 2: Get single bounty details
  try {
    const bountyList = JSON.parse(response.body);
    const bountyId = bountyList.bounties && bountyList.bounties[0]?.id;
    
    if (bountyId) {
      response = http.get(`${BASE_URL}/bounties/${bountyId}`, {
        tags: { name: 'GetBounty' },
      });
      
      const getSuccess = check(response, {
        'get bounty status 200': (r) => r.status === 200,
        'get bounty < 200ms': (r) => r.timings.duration < 200,
        'get bounty has valid data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.id === bountyId;
          } catch (e) {
            return false;
          }
        },
      });
      
      if (!getSuccess) {
        errorRate.add(1);
      } else {
        getBountyDuration.add(response.timings.duration);
      }
    }
  } catch (e) {
    console.error('Error parsing bounty list:', e);
    errorRate.add(1);
  }
  
  // Simulate user reading the details
  sleep(2);

  // Scenario 3: Search bounties (heavier operation)
  const searchTerms = ['web', 'mobile', 'design', 'data', 'test'];
  const randomTerm = searchTerms[Math.floor(Math.random() * searchTerms.length)];
  
  response = http.get(`${BASE_URL}/search/bounties?q=${randomTerm}&location=Remote`, {
    tags: { name: 'SearchBounties' },
  });
  
  const searchSuccess = check(response, {
    'search status 200': (r) => r.status === 200,
    'search < 1000ms': (r) => r.timings.duration < 1000,
    'search returns results': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.bounties && Array.isArray(body.bounties);
      } catch (e) {
        return false;
      }
    },
  });
  
  if (!searchSuccess) {
    errorRate.add(1);
  } else {
    searchBountiesDuration.add(response.timings.duration);
  }
  
  // Simulate user reviewing search results
  sleep(1);
}

/**
 * Setup function - runs once per VU before the test starts
 */
export function setup() {
  console.log(`Starting load test against ${BASE_URL}`);
  
  // Verify server is accessible
  const response = http.get(`${BASE_URL}/health`);
  if (response.status !== 200) {
    throw new Error(`Server health check failed: ${response.status}`);
  }
  
  console.log('Server health check passed');
  return { startTime: Date.now() };
}

/**
 * Teardown function - runs once after all VUs complete
 */
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Load test completed in ${duration.toFixed(2)} seconds`);
}
