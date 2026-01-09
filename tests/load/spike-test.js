/**
 * k6 Spike Load Test
 * 
 * Tests system response to sudden traffic spikes.
 * Sudden jump from 10 to 200 users to test system resilience.
 * 
 * Usage:
 *   k6 run tests/load/spike-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export let options = {
  stages: [
    { duration: '1m', target: 10 },   // Start with 10 users
    { duration: '10s', target: 200 }, // Spike to 200 users in 10 seconds
    { duration: '3m', target: 200 },  // Stay at 200 users
    { duration: '1m', target: 10 },   // Drop back to 10 users
    { duration: '2m', target: 10 },   // Recover at 10 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // More lenient during spike
    http_req_failed: ['rate<0.05'],     // Allow up to 5% errors during spike
    errors: ['rate<0.10'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  // Test critical read operations during spike
  let response = http.get(`${BASE_URL}/bounties?status=open&limit=10`);
  check(response, {
    'list bounties status 200': (r) => r.status === 200,
  }) || errorRate.add(1);
  
  sleep(Math.random() * 2 + 1); // Random sleep 1-3 seconds
}

export function setup() {
  console.log('Starting spike test (10 -> 200 users)');
  const response = http.get(`${BASE_URL}/health`);
  if (response.status !== 200) {
    throw new Error('Server health check failed');
  }
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Spike test completed in ${duration.toFixed(2)} seconds`);
}
