/**
 * Sample Expo integration stub for the BountyExpo API client
 * 
 * This demonstrates how to integrate the API client in an Expo React Native app
 * with authentication token management and React hooks usage.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Button, FlatList, Alert, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import the API client and hooks
import { 
  createApiClient, 
  useGetBounties, 
  useCreateBounty, 
  useAcceptBounty, 
  useCompleteBounty,
  type Bounty,
  type AuthTokens,
  type ApiClientConfig 
} from '../src';

// Token storage keys
const ACCESS_TOKEN_KEY = '@bounty_access_token';
const REFRESH_TOKEN_KEY = '@bounty_refresh_token';

// API configuration
const API_CONFIG: ApiClientConfig = {
  baseUrl: 'https://your-hostinger-domain.com',
  timeout: 30000,
  retries: 3,
  
  // Token management callbacks
  getAccessToken: () => {
    // In a real app, you might want to use a state management solution
    // This is a simplified version for demonstration
    return null; // Would be retrieved from AsyncStorage or state
  },
  
  getRefreshToken: () => {
    return null; // Would be retrieved from AsyncStorage or state
  },
  
  onTokenRefresh: async (tokens: AuthTokens) => {
    // Store new tokens
    await AsyncStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    console.log('Tokens refreshed successfully');
  },
};

/**
 * Token management hook
 */
function useTokenManager() {
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    loadTokens();
  }, []);

  const loadTokens = async () => {
    try {
      const [accessToken, refreshToken] = await Promise.all([
        AsyncStorage.getItem(ACCESS_TOKEN_KEY),
        AsyncStorage.getItem(REFRESH_TOKEN_KEY),
      ]);

      if (accessToken && refreshToken) {
        setTokens({
          accessToken,
          refreshToken,
          expiresAt: Date.now() + 3600000, // Assume 1 hour expiry
        });
      }
    } catch (error) {
      console.error('Failed to load tokens:', error);
    } finally {
      setIsReady(true);
    }
  };

  const setTokensAndStore = async (newTokens: AuthTokens) => {
    setTokens(newTokens);
    await AsyncStorage.setItem(ACCESS_TOKEN_KEY, newTokens.accessToken);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, newTokens.refreshToken);
  };

  const clearTokens = async () => {
    setTokens(null);
    await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]);
  };

  return {
    tokens,
    isReady,
    hasTokens: Boolean(tokens),
    setTokens: setTokensAndStore,
    clearTokens,
  };
}

/**
 * Component demonstrating bounty list fetching
 */
function BountyListExample() {
  const { data, loading, error, refetch, loadMore, hasMore } = useGetBounties({
    page: 1,
    limit: 10,
  });

  const renderBounty = ({ item }: { item: Bounty }) => (
    <View style={styles.bountyItem}>
      <Text style={styles.bountyTitle}>{item.title}</Text>
      <Text style={styles.bountyDescription}>{item.description}</Text>
      <Text style={styles.bountyAmount}>
        {item.amount ? `$${item.amount}` : 'For Honor'}
      </Text>
      {item.location && <Text style={styles.bountyLocation}>{item.location}</Text>}
    </View>
  );

  if (loading && data.length === 0) {
    return (
      <View style={styles.centered}>
        <Text>Loading bounties...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Error: {error}</Text>
        <Button title="Retry" onPress={refetch} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        renderItem={renderBounty}
        keyExtractor={(item) => String(item.id)}
        refreshing={loading}
        onRefresh={refetch}
        onEndReached={hasMore ? loadMore : undefined}
        onEndReachedThreshold={0.1}
      />
    </View>
  );
}

/**
 * Component demonstrating bounty creation
 */
function CreateBountyExample() {
  const { createBounty, loading, error } = useCreateBounty();

  const handleCreateBounty = async () => {
    const result = await createBounty({
      title: 'Sample Bounty',
      description: 'This is a test bounty created from the API client',
      amount: 50,
      is_for_honor: false,
      work_type: 'online',
      timeline: '1 week',
      skills_required: 'React Native, TypeScript',
    });

    if (result) {
      Alert.alert('Success', 'Bounty created successfully!');
    } else if (error) {
      Alert.alert('Error', error);
    }
  };

  return (
    <View style={styles.container}>
      <Button
        title={loading ? 'Creating...' : 'Create Sample Bounty'}
        onPress={handleCreateBounty}
        disabled={loading}
      />
      {error && <Text style={styles.error}>Error: {error}</Text>}
    </View>
  );
}

/**
 * Component demonstrating bounty acceptance
 */
function AcceptBountyExample({ bountyId }: { bountyId: number }) {
  const { acceptBounty, loading, error } = useAcceptBounty();

  const handleAcceptBounty = async () => {
    const result = await acceptBounty({
      bountyId,
      message: 'I would like to work on this bounty!',
    });

    if (result) {
      Alert.alert('Success', 'Bounty application submitted!');
    } else if (error) {
      Alert.alert('Error', error);
    }
  };

  return (
    <View style={styles.container}>
      <Button
        title={loading ? 'Applying...' : 'Apply for Bounty'}
        onPress={handleAcceptBounty}
        disabled={loading}
      />
      {error && <Text style={styles.error}>Error: {error}</Text>}
    </View>
  );
}

/**
 * Component demonstrating bounty completion
 */
function CompleteBountyExample({ bountyId }: { bountyId: number }) {
  const { completeBounty, loading, error } = useCompleteBounty();

  const handleCompleteBounty = async () => {
    const result = await completeBounty({
      bountyId,
      completionNote: 'Work has been completed as requested.',
      proof: 'https://github.com/example/proof-of-work',
    });

    if (result) {
      Alert.alert('Success', 'Bounty marked as completed!');
    } else if (error) {
      Alert.alert('Error', error);
    }
  };

  return (
    <View style={styles.container}>
      <Button
        title={loading ? 'Completing...' : 'Mark as Complete'}
        onPress={handleCompleteBounty}
        disabled={loading}
      />
      {error && <Text style={styles.error}>Error: {error}</Text>}
    </View>
  );
}

/**
 * Main app component demonstrating the API client integration
 */
export default function ApiClientExampleApp() {
  const tokenManager = useTokenManager();

  // Initialize the API client once tokens are loaded
  useEffect(() => {
    if (tokenManager.isReady) {
      createApiClient(API_CONFIG);
    }
  }, [tokenManager.isReady]);

  if (!tokenManager.isReady) {
    return (
      <View style={styles.centered}>
        <Text>Loading...</Text>
      </View>
    );
  }

  if (!tokenManager.hasTokens) {
    return (
      <View style={styles.centered}>
        <Text>Please log in to use the API client</Text>
        <Button
          title="Simulate Login"
          onPress={() => {
            // In a real app, this would come from your authentication flow
            tokenManager.setTokens({
              accessToken: 'sample_access_token',
              refreshToken: 'sample_refresh_token',
              expiresAt: Date.now() + 3600000, // 1 hour from now
            });
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>BountyExpo API Client Example</Text>
      
      <Text style={styles.sectionTitle}>Bounty List</Text>
      <BountyListExample />
      
      <Text style={styles.sectionTitle}>Create Bounty</Text>
      <CreateBountyExample />
      
      <Text style={styles.sectionTitle}>Accept Bounty (ID: 1)</Text>
      <AcceptBountyExample bountyId={1} />
      
      <Text style={styles.sectionTitle}>Complete Bounty (ID: 1)</Text>
      <CompleteBountyExample bountyId={1} />
      
      <Button title="Logout" onPress={tokenManager.clearTokens} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 10,
  },
  bountyItem: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 8,
  },
  bountyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  bountyDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  bountyAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2e7d32',
    marginBottom: 4,
  },
  bountyLocation: {
    fontSize: 12,
    color: '#999',
  },
  error: {
    color: '#d32f2f',
    fontSize: 14,
    marginTop: 8,
  },
});

/**
 * Usage example:
 * 
 * 1. Install the package in your Expo project
 * 2. Import and use the hooks in your components
 * 3. Configure the API client with your server URL and token management
 * 4. Handle authentication states and errors appropriately
 * 
 * Example implementation in App.tsx:
 * 
 * import ApiClientExampleApp from '@bountyexpo/api-client/examples/expo-integration';
 * 
 * export default function App() {
 *   return <ApiClientExampleApp />;
 * }
 */