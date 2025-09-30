# @bountyexpo/api-client

TypeScript API client for BountyExpo with React hooks for seamless integration in React Native and Expo applications.

## Features

- 🚀 **TypeScript-first** - Full type safety and IntelliSense support
- 🔄 **Auto Token Refresh** - Handles 401 responses with automatic token refresh
- 🪝 **React Hooks** - Declarative API usage with loading states and error handling
- 📱 **React Native Ready** - Designed for Expo and React Native apps
- 🔁 **Retry Logic** - Automatic retries with exponential backoff
- 📄 **Pagination Support** - Built-in pagination handling for list endpoints

## Installation

```bash
npm install @bountyexpo/api-client
# or
yarn add @bountyexpo/api-client
# or
pnpm add @bountyexpo/api-client
```

## Quick Start

### 1. Configure the API Client

```typescript
import { createApiClient } from '@bountyexpo/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const apiClient = createApiClient({
  baseUrl: 'https://your-api-domain.com',
  timeout: 30000,
  retries: 3,
  
  // Token management
  getAccessToken: () => AsyncStorage.getItem('@access_token'),
  getRefreshToken: () => AsyncStorage.getItem('@refresh_token'),
  onTokenRefresh: async (tokens) => {
    await AsyncStorage.setItem('@access_token', tokens.accessToken);
    await AsyncStorage.setItem('@refresh_token', tokens.refreshToken);
  },
});
```

### 2. Use React Hooks in Components

```typescript
import React from 'react';
import { View, Text, Button, FlatList } from 'react-native';
import { useGetBounties, useCreateBounty } from '@bountyexpo/api-client';

function BountyList() {
  const { data, loading, error, refetch } = useGetBounties({ 
    page: 1, 
    limit: 20 
  });

  if (loading) return <Text>Loading...</Text>;
  if (error) return <Text>Error: {error}</Text>;

  return (
    <FlatList
      data={data}
      renderItem={({ item }) => (
        <View>
          <Text>{item.title}</Text>
          <Text>{item.description}</Text>
          <Text>${item.amount}</Text>
        </View>
      )}
      keyExtractor={(item) => item.id}
      onRefresh={refetch}
      refreshing={loading}
    />
  );
}

function CreateBountyForm() {
  const { createBounty, loading, error } = useCreateBounty();

  const handleSubmit = async () => {
    const bounty = await createBounty({
      title: 'My New Bounty',
      description: 'Description here',
      amount: 100,
      is_for_honor: false,
    });
    
    if (bounty) {
      console.log('Bounty created:', bounty);
    }
  };

  return (
    <View>
      <Button 
        title={loading ? 'Creating...' : 'Create Bounty'} 
        onPress={handleSubmit}
        disabled={loading}
      />
      {error && <Text>Error: {error}</Text>}
    </View>
  );
}
```

## API Reference

### Hooks

#### `useGetBounties(options?)`

Fetch bounties with pagination and filtering.

```typescript
const { 
  data,           // Bounty[] - Array of bounties
  loading,        // boolean - Loading state
  error,          // string | null - Error message
  refetch,        // () => void - Refetch data
  loadMore,       // () => void - Load next page
  hasMore,        // boolean - Whether more data is available
  pagination      // PaginationInfo - Pagination metadata
} = useGetBounties({
  page: 1,
  limit: 20,
  status: 'open',
  location: 'New York',
  search: 'react native'
});
```

#### `useCreateBounty()`

Create a new bounty.

```typescript
const { 
  data,           // Bounty | null - Created bounty
  loading,        // boolean - Loading state
  error,          // string | null - Error message
  createBounty,   // (data: CreateBountyRequest) => Promise<Bounty | null>
  reset           // () => void - Reset state
} = useCreateBounty();
```

#### `useAcceptBounty()`

Accept/apply for a bounty.

```typescript
const { 
  data,           // BountyRequest | null - Created request
  loading,        // boolean - Loading state
  error,          // string | null - Error message
  acceptBounty,   // (request: AcceptBountyRequest) => Promise<BountyRequest | null>
  reset           // () => void - Reset state
} = useAcceptBounty();
```

#### `useCompleteBounty()`

Mark a bounty as completed.

```typescript
const { 
  data,           // Bounty | null - Updated bounty
  loading,        // boolean - Loading state
  error,          // string | null - Error message
  completeBounty, // (request: CompleteBountyRequest) => Promise<Bounty | null>
  reset           // () => void - Reset state
} = useCompleteBounty();
```

### Direct API Client Usage

For more control, you can use the API client directly:

```typescript
import { ApiClient } from '@bountyexpo/api-client';

const client = new ApiClient({
  baseUrl: 'https://your-api-domain.com',
  // ... other config
});

// Get bounties
const bounties = await client.getBounties({ page: 1, limit: 10 });

// Create bounty
const bounty = await client.createBounty({
  title: 'New Bounty',
  description: 'Description',
  amount: 100,
  is_for_honor: false,
});

// Accept bounty
const request = await client.acceptBounty({
  bountyId: 1,
  message: 'I want to work on this!',
});

// Complete bounty
const completed = await client.completeBounty({
  bountyId: 1,
  completionNote: 'Work is done!',
});
```

## Type Definitions

The package exports comprehensive TypeScript types:

```typescript
import type { 
  Bounty,
  BountyRequest,
  CreateBountyRequest,
  AcceptBountyRequest,
  CompleteBountyRequest,
  ApiResponse,
  PaginatedResponse,
  AuthTokens,
  ApiClientConfig 
} from '@bountyexpo/api-client';
```

## Authentication

The API client handles JWT token authentication with automatic refresh:

1. **Initial Setup**: Provide `getAccessToken` and `getRefreshToken` functions
2. **Automatic Refresh**: On 401 responses, automatically attempts token refresh
3. **Token Storage**: Use `onTokenRefresh` callback to store new tokens
4. **Retry Logic**: Automatically retries failed requests after token refresh

## Error Handling

All hooks and API methods include comprehensive error handling:

- Network errors are caught and returned as error messages
- HTTP errors are parsed from response bodies
- Loading states are managed automatically
- Retry logic handles temporary failures

## Example Integration

See `examples/expo-integration.tsx` for a complete working example of:

- Token management with AsyncStorage
- Error handling and loading states
- List rendering with FlatList
- Form submission with validation
- Authentication flow

## Development

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Type check
npm run type-check

# Watch mode for development
npm run dev
```

## License

MIT