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
  onTokenRefresh: async (tokens: AuthTokens) => {
    await AsyncStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  },
  
  getAccessToken: () => {
    // This will be set by the useTokenManager hook
    return tokenManager.accessToken;
  },
  
  getRefreshToken: () => {
    // This will be set by the useTokenManager hook
    return tokenManager.refreshToken;
  },
};

// Simple token manager (in a real app, this might be a context or store)
const tokenManager = {
  accessToken: null as string | null,
  refreshToken: null as string | null,
};

/**
 * Hook to manage authentication tokens
 */
function useTokenManager() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const loadTokens = async () => {
      try {
        const accessToken = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
        const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
        
        tokenManager.accessToken = accessToken;
        tokenManager.refreshToken = refreshToken;
        
        setIsReady(true);
      } catch (error) {
        console.error('Failed to load tokens:', error);
        setIsReady(true);
      }
    };

    loadTokens();
  }, []);

  const setTokens = async (tokens: AuthTokens) => {
    tokenManager.accessToken = tokens.accessToken;
    tokenManager.refreshToken = tokens.refreshToken;
    
    await AsyncStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  };

  const clearTokens = async () => {
    tokenManager.accessToken = null;
    tokenManager.refreshToken = null;
    
    await AsyncStorage.removeItem(ACCESS_TOKEN_KEY);
    await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
  };

  return {
    isReady,
    hasTokens: !!tokenManager.accessToken,
    setTokens,
    clearTokens,
  };
}

/**
 * Component demonstrating bounty listing with the API client
 */
function BountyListExample() {
  const { data: bounties, loading, error, refresh } = useGetBounties({
    status: 'open',
    limit: 10,
  });

  const renderBounty = ({ item }: { item: Bounty }) => (
    <View style={styles.bountyItem}>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.description}>{item.description}</Text>
      <Text style={styles.amount}>
        {item.is_for_honor ? 'For Honor' : `$${item.amount}`}
      </Text>
      <Text style={styles.status}>Status: {item.status}</Text>
    </View>
  );

  if (loading) {
    return <Text>Loading bounties...</Text>;
  }

  if (error) {
    return (
      <View>
        <Text style={styles.error}>Error: {error}</Text>
        <Button title="Retry" onPress={refresh} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={bounties}
        renderItem={renderBounty}
        keyExtractor={(item) => item.id.toString()}
        refreshing={loading}
        onRefresh={refresh}
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
      Alert.alert('Success', 'Bounty request submitted!');
    } else if (error) {
      Alert.alert('Error', error);
    }
  };

  return (
    <View style={styles.container}>
      <Button
        title={loading ? 'Submitting...' : 'Accept Bounty'}
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
      completionNotes: 'Task completed successfully! Please review.',
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
        title={loading ? 'Completing...' : 'Complete Bounty'}
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
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  amount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0a7ea4',
    marginBottom: 4,
  },
  status: {
    fontSize: 12,
    color: '#888',
  },
  error: {
    color: 'red',
    marginTop: 8,
  },
});