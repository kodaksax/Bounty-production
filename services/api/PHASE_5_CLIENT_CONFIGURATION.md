# Phase 5: Client Configuration Updates

## Overview
Guide for updating client applications to use the consolidated backend service.

## 5.1 Environment Variables

### Before: Multiple Endpoints
```bash
# Old configuration with multiple services
API_BASE_URL=http://localhost:3001          # api/server.js
FASTIFY_API_URL=http://localhost:3001        # services/api
PAYMENT_API_URL=http://localhost:3001        # server/index.js
```

### After: Single Endpoint
```bash
# New consolidated configuration
API_BASE_URL=http://localhost:3001

# Optional: Add specific feature flags if needed
ENABLE_WEBSOCKET=true
ENABLE_PUSH_NOTIFICATIONS=true
ENABLE_ANALYTICS=true
```

### Production Configuration
```bash
# Production environment
API_BASE_URL=https://api.bountyexpo.com
ENABLE_MONITORING=true
ENABLE_TRACING=true
LOG_LEVEL=info
```

## 5.2 API Client Configuration

### TypeScript/React Native Client

#### Update base configuration
```typescript
// lib/api-client.ts

const API_CONFIG = {
  // Single base URL for all API calls
  baseURL: process.env.API_BASE_URL || 'http://localhost:3001',
  
  // Timeout configuration
  timeout: 30000, // 30 seconds
  
  // Headers
  headers: {
    'Content-Type': 'application/json',
  },
  
  // WebSocket configuration
  wsURL: process.env.API_BASE_URL?.replace('http', 'ws') || 'ws://localhost:3001',
};

export default API_CONFIG;
```

#### API Client Implementation
```typescript
// lib/api-client.ts

import axios, { AxiosInstance } from 'axios';
import { getAuthToken } from './auth';

class APIClient {
  private client: AxiosInstance;
  
  constructor() {
    this.client = axios.create({
      baseURL: API_CONFIG.baseURL,
      timeout: API_CONFIG.timeout,
      headers: API_CONFIG.headers,
    });
    
    // Add auth interceptor
    this.client.interceptors.request.use(
      async (config) => {
        const token = await getAuthToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );
    
    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          // Handle token expiration
          await handleTokenRefresh();
        }
        return Promise.reject(error);
      }
    );
  }
  
  // Auth endpoints
  async signIn(email: string, password: string) {
    const response = await this.client.post('/auth/sign-in', { email, password });
    return response.data;
  }
  
  async signUp(email: string, password: string) {
    const response = await this.client.post('/auth/sign-up', { email, password });
    return response.data;
  }
  
  // Profile endpoints
  async getProfile() {
    const response = await this.client.get('/api/profile');
    return response.data;
  }
  
  async updateProfile(data: any) {
    const response = await this.client.post('/api/profiles', data);
    return response.data;
  }
  
  // Bounty endpoints
  async listBounties(filters?: any) {
    const response = await this.client.get('/api/bounties', { params: filters });
    return response.data;
  }
  
  async createBounty(data: any) {
    const response = await this.client.post('/api/bounties', data);
    return response.data;
  }
  
  async acceptBounty(bountyId: string) {
    const response = await this.client.post(`/api/bounties/${bountyId}/accept`);
    return response.data;
  }
  
  // Payment endpoints
  async createPaymentIntent(amountCents: number) {
    const response = await this.client.post('/api/payments/create-intent', { amountCents });
    return response.data;
  }
  
  // Wallet endpoints
  async getWalletBalance() {
    const response = await this.client.get('/wallet/balance');
    return response.data;
  }
  
  // Notifications
  async getNotifications(limit = 50, offset = 0) {
    const response = await this.client.get('/notifications', {
      params: { limit, offset }
    });
    return response.data;
  }
  
  async registerPushToken(token: string) {
    const response = await this.client.post('/notifications/register-push-token', {
      pushToken: token
    });
    return response.data;
  }
}

export const apiClient = new APIClient();
```

### WebSocket Client Configuration
```typescript
// lib/websocket-client.ts

class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  connect(token: string) {
    const wsURL = `${API_CONFIG.wsURL}/messages/subscribe?token=${token}`;
    
    this.ws = new WebSocket(wsURL);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.reconnect(token);
    };
  }
  
  private reconnect(token: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect(token);
      }, 1000 * this.reconnectAttempts);
    }
  }
  
  private handleMessage(data: any) {
    // Handle different message types
    switch (data.type) {
      case 'new_message':
        // Update chat UI
        break;
      case 'bounty_updated':
        // Update bounty UI
        break;
      default:
        console.log('Unknown message type:', data.type);
    }
  }
  
  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsClient = new WebSocketClient();
```

## 5.3 Testing All Client Flows

### Manual Testing Checklist

#### Authentication Flow
- [ ] Sign up with new account
- [ ] Sign in with existing account
- [ ] Token refresh works correctly
- [ ] Sign out clears tokens
- [ ] Session persistence works

#### Profile Management
- [ ] Get current user profile
- [ ] Update profile information
- [ ] Upload profile avatar
- [ ] View other user profiles

#### Bounty Creation
- [ ] Create new bounty
- [ ] Set bounty amount
- [ ] Add location
- [ ] Upload images
- [ ] Submit successfully

#### Bounty Application
- [ ] View bounty list
- [ ] Filter and search
- [ ] View bounty details
- [ ] Apply to bounty
- [ ] Accept bounty

#### Payment Flow
- [ ] Add payment method
- [ ] Create payment intent
- [ ] Escrow funds
- [ ] Complete payment
- [ ] View transaction history

#### Messaging
- [ ] Send message
- [ ] Receive message
- [ ] Real-time updates via WebSocket
- [ ] Typing indicators
- [ ] Message read status

#### Notifications
- [ ] Receive push notifications
- [ ] View in-app notifications
- [ ] Mark as read
- [ ] Notification preferences

### Automated Testing

#### Integration Tests
```typescript
// __tests__/api-integration.test.ts

describe('API Integration Tests', () => {
  let authToken: string;
  
  beforeAll(async () => {
    // Sign in to get auth token
    const result = await apiClient.signIn('test@example.com', 'password123');
    authToken = result.token;
  });
  
  test('should get user profile', async () => {
    const profile = await apiClient.getProfile();
    expect(profile).toHaveProperty('id');
    expect(profile).toHaveProperty('email');
  });
  
  test('should list bounties', async () => {
    const bounties = await apiClient.listBounties();
    expect(Array.isArray(bounties)).toBe(true);
  });
  
  test('should create bounty', async () => {
    const bounty = await apiClient.createBounty({
      title: 'Test Bounty',
      description: 'This is a test',
      amount: 5000
    });
    expect(bounty).toHaveProperty('id');
  });
  
  test('should get wallet balance', async () => {
    const balance = await apiClient.getWalletBalance();
    expect(balance).toHaveProperty('availableBalance');
  });
});
```

## Migration Strategy

### Phase 1: Update Configuration
1. Update environment variables in all environments
2. Update API client base URL
3. Test in development environment

### Phase 2: Deploy to Staging
1. Deploy updated client to staging
2. Run full integration tests
3. Verify all flows work correctly

### Phase 3: Gradual Rollout
1. Deploy to 5% of users
2. Monitor metrics and errors
3. Increase to 25% if stable
4. Increase to 50% if stable
5. Full rollout to 100%

### Phase 4: Monitor and Validate
1. Watch error rates
2. Check performance metrics
3. Monitor user feedback
4. Be ready to rollback if needed

## Rollback Plan

If issues are detected:

1. **Immediate**: Revert environment variables to old configuration
2. **Identify**: Check logs and metrics to identify root cause
3. **Fix**: Apply fix to consolidated service
4. **Retest**: Verify fix in staging
5. **Retry**: Gradual rollout again

## Success Criteria

- ✅ All client flows work with single endpoint
- ✅ No broken endpoints
- ✅ Performance is same or better
- ✅ Error rate is same or lower
- ✅ User experience is unchanged
- ✅ Metrics show successful migration

## Support

For issues or questions:
- Check health endpoint: `GET /health/detailed`
- Check metrics: `GET /metrics/json`
- Review documentation: See `BACKEND_CONSOLIDATION_IMPLEMENTATION_GUIDE.md`
