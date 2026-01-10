/**
 * k6 Baseline Load Test
 * 
 * Tests with minimal load to establish baseline performance metrics.
 * 10 concurrent users for 5 minutes.
 * 
 * Usage:
 *   k6 run tests/load/baseline-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  vus: 10,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<300'],  // Stricter threshold for baseline
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  // List bounties
  let response = http.get(`${BASE_URL}/bounties?status=open&limit=20`);
  check(response, {
    'status 200': (r) => r.status === 200,
    'response time < 300ms': (r) => r.timings.duration < 300,
  }) || errorRate.add(1);
  
  sleep(1);

  // Get single bounty
  try {
    const bounties = JSON.parse(response.body).bounties;
    if (bounties && bounties.length > 0) {
      response = http.get(`${BASE_URL}/bounties/${bounties[0].id}`);
      check(response, {
        'get bounty status 200': (r) => r.status === 200,
        'get bounty < 150ms': (r) => r.timings.duration < 150,
      }) || errorRate.add(1);
    }
  } catch (e) {
    errorRate.add(1);
  }
  
  sleep(2);
}

export function setup() {
  console.log('Starting baseline test (10 users, 5 minutes)');
  const response = http.get(`${BASE_URL}/health`);
  if (response.status !== 200) {
    throw new Error('Server health check failed');
  }
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Baseline test completed in ${duration.toFixed(2)} seconds`);
}
