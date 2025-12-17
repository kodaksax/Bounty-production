#!/bin/bash

# Test script for push token registration endpoint
# Usage: ./scripts/test-push-token-registration.sh [API_URL] [AUTH_TOKEN]

set -e

API_URL="${1:-http://localhost:3001}"
AUTH_TOKEN="${2}"

if [ -z "$AUTH_TOKEN" ]; then
    echo "Error: AUTH_TOKEN is required"
    echo "Usage: $0 [API_URL] AUTH_TOKEN"
    echo "Example: $0 http://localhost:3001 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    exit 1
fi

echo "Testing push token registration at $API_URL"
echo "=========================================="
echo ""

# Test 1: Valid Expo push token
echo "Test 1: Valid Expo push token"
VALID_TOKEN="ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${API_URL}/notifications/register-token" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -d "{\"token\": \"${VALID_TOKEN}\", \"deviceId\": \"test-device-1\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Status: $HTTP_CODE"
echo "Response: $BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Test 1 PASSED"
elif [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "409" ]; then
    echo "⚠️  Test 1 EXPECTED FAILURE (user profile not created yet)"
else
    echo "❌ Test 1 FAILED"
fi
echo ""

# Test 2: Invalid token format (should return 400)
echo "Test 2: Invalid token format"
INVALID_TOKEN="not-a-valid-expo-token"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${API_URL}/notifications/register-token" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -d "{\"token\": \"${INVALID_TOKEN}\", \"deviceId\": \"test-device-2\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Status: $HTTP_CODE"
echo "Response: $BODY"
echo ""

if [ "$HTTP_CODE" = "400" ]; then
    echo "✅ Test 2 PASSED"
else
    echo "❌ Test 2 FAILED (expected 400, got $HTTP_CODE)"
fi
echo ""

# Test 3: Missing token (should return 400)
echo "Test 3: Missing token"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${API_URL}/notifications/register-token" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -d "{\"deviceId\": \"test-device-3\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Status: $HTTP_CODE"
echo "Response: $BODY"
echo ""

if [ "$HTTP_CODE" = "400" ]; then
    echo "✅ Test 3 PASSED"
else
    echo "❌ Test 3 FAILED (expected 400, got $HTTP_CODE)"
fi
echo ""

# Test 4: Empty token (should return 400)
echo "Test 4: Empty token"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${API_URL}/notifications/register-token" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -d "{\"token\": \"\", \"deviceId\": \"test-device-4\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Status: $HTTP_CODE"
echo "Response: $BODY"
echo ""

if [ "$HTTP_CODE" = "400" ]; then
    echo "✅ Test 4 PASSED"
else
    echo "❌ Test 4 FAILED (expected 400, got $HTTP_CODE)"
fi
echo ""

# Test 5: Valid ExpoPushToken format (alternative format)
echo "Test 5: Valid ExpoPushToken format (alternative)"
VALID_TOKEN_ALT="ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${API_URL}/notifications/register-token" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -d "{\"token\": \"${VALID_TOKEN_ALT}\", \"deviceId\": \"test-device-5\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Status: $HTTP_CODE"
echo "Response: $BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Test 5 PASSED"
elif [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "409" ]; then
    echo "⚠️  Test 5 EXPECTED FAILURE (user profile not created yet)"
else
    echo "❌ Test 5 FAILED"
fi
echo ""

echo "=========================================="
echo "Testing complete!"
echo ""
echo "Note: Tests 1 and 5 may fail with 404/409 if the user profile"
echo "      doesn't exist yet. This is expected behavior - the profile"
echo "      should be created via the /me endpoint first."
