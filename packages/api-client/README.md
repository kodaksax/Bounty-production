# @bountyexpo/api-client

A typed API client package for the BountyExpo application, providing fetch-based wrappers with automatic token refresh and React hooks integration.

## Features

- ✅ Typed wrappers around fetch API
- ✅ Automatic token refresh on 401 responses  
- ✅ Retry logic with exponential backoff
- ✅ React hooks for common operations
- ✅ TypeScript support
- ✅ Request/response interceptors
- ✅ Pagination support

## Core Methods

- `getBounties(options?)` - Fetch bounties with filtering and pagination
- `createBounty(data)` - Create a new bounty
- `acceptBounty(request)` - Accept/apply for a bounty
- `completeBounty(request)` - Mark a bounty as completed

## Installation

```bash
npm install @bountyexpo/api-client
# or
yarn add @bountyexpo/api-client
```

## Quick Start

### 1. Initialize the API Client

```typescript
import { createApiClient } from '@bountyexpo/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const apiClient = createApiClient({
  baseUrl: 'https://your-api-domain.com',
  timeout: 30000,
  retries: 3,
  
  // Token management
  getAccessToken: () => AsyncStorage.getItem('access_token'),
  getRefreshToken: () => AsyncStorage.getItem('refresh_token'),
  onTokenRefresh: async (tokens) => {
    await AsyncStorage.setItem('access_token', tokens.accessToken);
    await AsyncStorage.setItem('refresh_token', tokens.refreshToken);
  },
});
```

### 2. Using React Hooks

```tsx
import React from 'react';
import { View, Text, Button } from 'react-native';
import { useGetBounties, useCreateBounty } from '@bountyexpo/api-client';

function BountyList() {
  const { data: bounties, loading, error, refresh } = useGetBounties({
    status: 'open',
    limit: 20,
  });

  const { createBounty, loading: creating } = useCreateBounty();

  const handleCreateBounty = async () => {
    const result = await createBounty({
      title: 'Fix my React Native app',
      description: 'Need help debugging a performance issue',
      amount: 100,
      is_for_honor: false,
      work_type: 'online',
    });
    
    if (result) {
      refresh(); // Refresh the list
    }
  };

  if (loading) return <Text>Loading...</Text>;
  if (error) return <Text>Error: {error}</Text>;

  return (
    <View>
      {bounties.map(bounty => (
        <Text key={bounty.id}>{bounty.title}</Text>
      ))}
      <Button 
        title={creating ? 'Creating...' : 'Create Bounty'} 
        onPress={handleCreateBounty}
        disabled={creating}
      />
    </View>
  );
}
```

### 3. Direct API Client Usage

```typescript
import { useApiClient } from '@bountyexpo/api-client';

function MyComponent() {
  const apiClient = useApiClient();

  const handleAction = async () => {
    // Get all bounties
    const bounties = await apiClient.getBounties({ status: 'open' });
    
    // Create a bounty
    const newBounty = await apiClient.createBounty({
      title: 'New Task',
      description: 'Task description',
      amount: 50,
      is_for_honor: false,
    });
    
    // Accept a bounty
    const request = await apiClient.acceptBounty({
      bountyId: 123,
      message: 'I would like to work on this!',
    });
    
    // Complete a bounty
    const completed = await apiClient.completeBounty({
      bountyId: 123,
      completionNotes: 'Task completed successfully',
    });
  };
}
```

## API Reference

### Core Types

```typescript
interface Bounty {
  id: number;
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  status: "open" | "in_progress" | "completed" | "archived";
  user_id: string;
  created_at: string;
  // ... additional fields
}

interface CreateBountyRequest {
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location?: string;
  work_type?: 'online' | 'in_person';
  // ... additional fields
}
```

### Available Hooks

- `useGetBounties(options?)` - Fetch and manage bounty list
- `useCreateBounty()` - Create bounty with loading states
- `useAcceptBounty()` - Accept/apply for bounties
- `useCompleteBounty()` - Mark bounties as completed
- `useGetBounty(id)` - Fetch a single bounty
- `useMutation(mutationFn)` - Generic mutation hook

### Configuration Options

```typescript
interface ApiClientConfig {
  baseUrl: string;
  timeout?: number; // Default: 30000ms
  retries?: number; // Default: 3
  onTokenRefresh?: (tokens: AuthTokens) => void;
  getAccessToken?: () => string | null;
  getRefreshToken?: () => string | null;
}
```

## Authentication & Token Refresh

The API client automatically handles token refresh when receiving 401 responses:

1. When a 401 is received, it attempts to refresh the token using the `refreshToken`
2. If refresh succeeds, the original request is retried with the new token
3. New tokens are saved via the `onTokenRefresh` callback
4. If refresh fails, the error is returned to the caller

## Error Handling

All API methods return a consistent response format:

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
```

React hooks provide loading states and error handling:

```typescript
const { data, loading, error } = useGetBounties();

if (loading) {
  // Show loading spinner
}

if (error) {
  // Handle error state
  console.error('API Error:', error);
}
```

## Examples

See the `examples/` directory for complete integration examples:

- `expo-integration.tsx` - Full Expo React Native integration with token management

## Development

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Watch for changes during development
npm run dev

# Type check
npm run type-check
```

## Contributing

1. Follow the existing code patterns
2. Add tests for new functionality
3. Update documentation for API changes
4. Use TypeScript strict mode

## License

MIT