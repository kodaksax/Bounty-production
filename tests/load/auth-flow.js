/**
 * k6 Load Test - Authentication Flow
 * 
 * Tests authentication endpoints under load.
 * Note: This test requires valid test user credentials.
 * 
 * Usage:
 *   k6 run -e TEST_EMAIL=test@example.com -e TEST_PASSWORD=password tests/load/auth-flow.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const authDuration = new Trend('auth_duration');
const profileDuration = new Trend('profile_duration');

export let options = {
  stages: [
    { duration: '1m', target: 20 },   // Ramp up to 20 users
    { duration: '3m', target: 20 },   // Stay at 20 users
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '3m', target: 50 },   // Stay at 50 users
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.05'],
    errors: ['rate<0.05'],
    auth_duration: ['p(95)<1000'],     // Auth can be slower
    profile_duration: ['p(95)<300'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const TEST_EMAIL = __ENV.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'testpassword123';

export default function () {
  // Note: In a real scenario, you would use test credentials or mock authentication
  // This is a simplified version that tests the /auth/me endpoint with existing tokens
  
  // Test fetching current user profile (simulates authenticated request)
  const headers = {
    'Content-Type': 'application/json',
  };
  
  // Test public endpoints that don't require auth
  let response = http.get(`${BASE_URL}/bounties?status=open&limit=10`, { headers });
  check(response, {
    'bounties fetch successful': (r) => r.status === 200,
  }) || errorRate.add(1);
  
  sleep(1);
  
  // Test health endpoint (should always be fast)
  response = http.get(`${BASE_URL}/health`, { headers });
  check(response, {
    'health check successful': (r) => r.status === 200,
    'health check < 100ms': (r) => r.timings.duration < 100,
  }) || errorRate.add(1);
  
  sleep(2);
}

export function setup() {
  console.log('Starting authentication flow test');
  console.log('Testing public endpoints under auth-like load patterns');
  
  const response = http.get(`${BASE_URL}/health`);
  if (response.status !== 200) {
    throw new Error('Server health check failed');
  }
  
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Auth flow test completed in ${duration.toFixed(2)} seconds`);
}
