/**
 * k6 Stress Test
 * 
 * Tests system limits by gradually increasing load to find breaking points.
 * Gradually increases to 500 users to identify bottlenecks.
 * 
 * Usage:
 *   k6 run tests/load/stress-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp to 100
    { duration: '3m', target: 100 },  // Stay at 100
    { duration: '2m', target: 200 },  // Ramp to 200
    { duration: '3m', target: 200 },  // Stay at 200
    { duration: '2m', target: 300 },  // Ramp to 300
    { duration: '3m', target: 300 },  // Stay at 300
    { duration: '2m', target: 400 },  // Ramp to 400
    { duration: '3m', target: 400 },  // Stay at 400
    { duration: '2m', target: 500 },  // Ramp to 500
    { duration: '3m', target: 500 },  // Stay at 500
    { duration: '3m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // Very lenient for stress test
    http_req_failed: ['rate<0.10'],     // Allow up to 10% errors
    errors: ['rate<0.15'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  // Focus on core read operations
  let response = http.get(`${BASE_URL}/bounties?status=open&limit=20`);
  
  // During stress testing, we accept 503 Service Unavailable as a valid response
  // This indicates the server is properly rate limiting or load shedding under extreme load
  const success = check(response, {
    'status 200 or 503': (r) => r.status === 200 || r.status === 503,
  });
  
  if (!success) {
    errorRate.add(1);
  }
  
  sleep(1);
}

export function setup() {
  console.log('Starting stress test (ramping to 500 users)');
  const response = http.get(`${BASE_URL}/health`);
  if (response.status !== 200) {
    throw new Error('Server health check failed');
  }
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Stress test completed in ${duration.toFixed(2)} seconds`);
}
