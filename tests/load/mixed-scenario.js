/**
 * k6 Load Test - Mixed Scenario
 * 
 * Tests a realistic mix of different operations to simulate real user behavior.
 * Includes browsing, searching, and viewing bounties with varied patterns.
 * 
 * Usage:
 *   k6 run tests/load/mixed-scenario.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const browsingUsers = new Counter('browsing_users');
const searchingUsers = new Counter('searching_users');
const detailViewers = new Counter('detail_viewers');

export let options = {
  stages: [
    { duration: '2m', target: 30 },
    { duration: '5m', target: 30 },
    { duration: '2m', target: 80 },
    { duration: '5m', target: 80 },
    { duration: '2m', target: 150 },
    { duration: '5m', target: 150 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<600'],
    http_req_failed: ['rate<0.02'],
    errors: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

/**
 * User behavior patterns:
 * - 50% browsers (list bounties, view a few)
 * - 30% searchers (search specific terms)
 * - 20% deep viewers (view many bounty details)
 */
export default function () {
  const userType = Math.random();
  
  if (userType < 0.5) {
    // Browser behavior
    browsingUsers.add(1);
    browserFlow();
  } else if (userType < 0.8) {
    // Searcher behavior
    searchingUsers.add(1);
    searcherFlow();
  } else {
    // Detail viewer behavior
    detailViewers.add(1);
    detailViewerFlow();
  }
}

function browserFlow() {
  // List bounties - multiple pages
  let response = http.get(`${BASE_URL}/bounties?status=open&limit=20&page=1`, {
    tags: { flow: 'browser' },
  });
  
  check(response, {
    'browser: list page 1 success': (r) => r.status === 200,
  }) || errorRate.add(1);
  
  sleep(2);
  
  // Browse to page 2
  response = http.get(`${BASE_URL}/bounties?status=open&limit=20&page=2`, {
    tags: { flow: 'browser' },
  });
  
  check(response, {
    'browser: list page 2 success': (r) => r.status === 200,
  }) || errorRate.add(1);
  
  sleep(3);
}

function searcherFlow() {
  // Multiple searches with different terms
  const searches = ['developer', 'design', 'data', 'mobile', 'web'];
  const term = searches[Math.floor(Math.random() * searches.length)];
  
  let response = http.get(`${BASE_URL}/search/bounties?q=${term}`, {
    tags: { flow: 'searcher' },
  });
  
  check(response, {
    'searcher: search success': (r) => r.status === 200,
  }) || errorRate.add(1);
  
  sleep(2);
  
  // Refine search with location
  response = http.get(`${BASE_URL}/search/bounties?q=${term}&location=Remote`, {
    tags: { flow: 'searcher' },
  });
  
  check(response, {
    'searcher: refined search success': (r) => r.status === 200,
  }) || errorRate.add(1);
  
  sleep(3);
}

function detailViewerFlow() {
  // Get list of bounties
  let response = http.get(`${BASE_URL}/bounties?status=open&limit=10`, {
    tags: { flow: 'viewer' },
  });
  
  if (response.status !== 200) {
    errorRate.add(1);
    return;
  }
  
  try {
    const bounties = JSON.parse(response.body).bounties;
    if (!bounties || bounties.length === 0) {
      return;
    }
    
    // View multiple bounty details
    const numToView = Math.min(3, bounties.length);
    for (let i = 0; i < numToView; i++) {
      response = http.get(`${BASE_URL}/bounties/${bounties[i].id}`, {
        tags: { flow: 'viewer' },
      });
      
      check(response, {
        'viewer: detail view success': (r) => r.status === 200,
      }) || errorRate.add(1);
      
      sleep(2); // Read time between bounties
    }
  } catch (e) {
    errorRate.add(1);
  }
  
  sleep(1);
}

export function setup() {
  console.log('Starting mixed scenario test');
  console.log('Simulating 50% browsers, 30% searchers, 20% detail viewers');
  
  const response = http.get(`${BASE_URL}/health`);
  if (response.status !== 200) {
    throw new Error('Server health check failed');
  }
  
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Mixed scenario test completed in ${duration.toFixed(2)} seconds`);
}
