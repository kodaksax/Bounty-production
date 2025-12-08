/**
 * Error Handling Usage Examples
 * Demonstrates how to use the error handling system in real scenarios
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { ErrorBanner } from '../components/error-banner';
import { ErrorBoundary } from '../lib/error-boundary';
import { useOfflineMode, useIsOnline } from '../hooks/useOfflineMode';
import { handleServiceError, retryOperation, type ServiceResult } from '../lib/services/service-error-handler';
import { getUserFriendlyError, type UserFriendlyError } from '../lib/utils/error-messages';

// ============================================================================
// Example 1: Service with Error Handling
// ============================================================================

interface User {
  id: string;
  name: string;
  email: string;
}

const userService = {
  /**
   * Fetch user with proper error handling
   */
  async getUser(id: string): Promise<ServiceResult<User>> {
    return handleServiceError(
      async () => {
        const response = await fetch(`/api/users/${id}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch user');
        }
        
        return await response.json();
      },
      {
        operation: 'getUser',
        retryable: true,
        context: { userId: id },
      }
    );
  },

  /**
   * Create user with retry logic
   */
  async createUser(userData: Omit<User, 'id'>): Promise<ServiceResult<User>> {
    return handleServiceError(
      async () => {
        // Use retry for network resilience
        return await retryOperation(
          async () => {
            const response = await fetch('/api/users', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(userData),
            });
            
            if (!response.ok) {
              throw new Error('Failed to create user');
            }
            
            return await response.json();
          },
          {
            maxAttempts: 3,
            initialDelayMs: 1000,
            onRetry: (attempt, error) => {
              console.log(`Retry attempt ${attempt}:`, error.message);
            },
          }
        );
      },
      {
        operation: 'createUser',
        retryable: false, // Don't auto-retry creation (handled by retryOperation)
        context: { email: userData.email },
      }
    );
  },
};

// ============================================================================
// Example 2: Component with Error Handling
// ============================================================================

export function UserProfileExample() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UserFriendlyError | null>(null);
  
  const loadUser = async (userId: string) => {
    setLoading(true);
    setError(null);
    
    const result = await userService.getUser(userId);
    
    setLoading(false);
    
    if (result.success) {
      setUser(result.data);
    } else {
      setError(result.error);
    }
  };
  
  const handleRetry = () => {
    if (user?.id) {
      loadUser(user.id);
    }
  };
  
  return (
    <View style={{ padding: 16 }}>
      {/* Show error banner if error occurred */}
      {error && (
        <ErrorBanner
          error={error}
          onDismiss={() => setError(null)}
          onAction={handleRetry}
          autoDismissMs={0} // Don't auto-dismiss
        />
      )}
      
      {/* Show loading state */}
      {loading && (
        <View style={{ padding: 20, alignItems: 'center' }}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 10 }}>Loading user...</Text>
        </View>
      )}
      
      {/* Show user data */}
      {user && !loading && (
        <View>
          <Text>Name: {user.name}</Text>
          <Text>Email: {user.email}</Text>
        </View>
      )}
    </View>
  );
}

// ============================================================================
// Example 3: Offline-Aware Component
// ============================================================================

export function OfflineAwareExample() {
  const { isOnline, queuedItemsCount, checkConnection } = useOfflineMode();
  const [message, setMessage] = useState('');
  
  const sendMessage = async () => {
    if (!isOnline) {
      // Queue for later
      console.log('Offline: Message will be sent when back online');
      // offlineQueueService.enqueue('message', { ... });
      return;
    }
    
    // Send immediately
    const result = await handleServiceError(
      async () => {
        const response = await fetch('/api/messages', {
          method: 'POST',
          body: JSON.stringify({ text: message }),
        });
        return response.json();
      },
      { operation: 'sendMessage', retryable: true }
    );
    
    if (result.success) {
      setMessage('');
    }
  };
  
  return (
    <View style={{ padding: 16 }}>
      {/* Show offline status */}
      {!isOnline && (
        <View style={{ padding: 12, backgroundColor: '#fee', borderRadius: 8, marginBottom: 12 }}>
          <Text style={{ color: '#c00' }}>
            You're offline. {queuedItemsCount} items queued.
          </Text>
          <TouchableOpacity onPress={checkConnection}>
            <Text style={{ color: '#00c', marginTop: 8 }}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Your form */}
      <Text>Message:</Text>
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder="Type a message..."
      />
      <TouchableOpacity onPress={sendMessage}>
        <Text>Send {!isOnline ? '(when online)' : ''}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ============================================================================
// Example 4: Simple Offline Check
// ============================================================================

export function SimpleOfflineCheck() {
  const isOnline = useIsOnline();
  
  return (
    <View>
      <Text>Status: {isOnline ? '🟢 Online' : '🔴 Offline'}</Text>
    </View>
  );
}

// ============================================================================
// Example 5: Error Boundary Usage
// ============================================================================

function PotentiallyBuggyComponent() {
  const [shouldError, setShouldError] = useState(false);
  
  if (shouldError) {
    // This will be caught by ErrorBoundary
    throw new Error('Intentional error for demonstration');
  }
  
  return (
    <View>
      <Text>This component works fine</Text>
      <TouchableOpacity onPress={() => setShouldError(true)}>
        <Text>Trigger Error</Text>
      </TouchableOpacity>
    </View>
  );
}

export function ErrorBoundaryExample() {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.log('Error caught by boundary:', error);
        // Send to analytics, etc.
      }}
    >
      <PotentiallyBuggyComponent />
    </ErrorBoundary>
  );
}

// ============================================================================
// Example 6: Converting Errors to User-Friendly Messages
// ============================================================================

export function ErrorConversionExample() {
  const [error, setError] = useState<UserFriendlyError | null>(null);
  
  const triggerError = async (errorType: string) => {
    try {
      // Simulate different error types
      switch (errorType) {
        case 'network':
          throw new Error('Network request failed');
        case 'auth':
          throw { status: 401, message: 'Unauthorized' };
        case 'validation':
          throw { status: 400, message: 'Invalid email format' };
        case 'rate_limit':
          throw { status: 429, message: 'Too many requests' };
        default:
          throw new Error('Unknown error');
      }
    } catch (err) {
      // Convert to user-friendly error
      const userError = getUserFriendlyError(err);
      setError(userError);
    }
  };
  
  return (
    <View style={{ padding: 16 }}>
      <Text>Trigger different error types:</Text>
      
      <TouchableOpacity onPress={() => triggerError('network')}>
        <Text>Network Error</Text>
      </TouchableOpacity>
      
      <TouchableOpacity onPress={() => triggerError('auth')}>
        <Text>Auth Error</Text>
      </TouchableOpacity>
      
      <TouchableOpacity onPress={() => triggerError('validation')}>
        <Text>Validation Error</Text>
      </TouchableOpacity>
      
      <TouchableOpacity onPress={() => triggerError('rate_limit')}>
        <Text>Rate Limit Error</Text>
      </TouchableOpacity>
      
      {error && (
        <View style={{ marginTop: 20, padding: 12, backgroundColor: '#fee' }}>
          <Text style={{ fontWeight: 'bold' }}>{error.title}</Text>
          <Text>{error.message}</Text>
          <Text>Type: {error.type}</Text>
          <Text>Retryable: {error.retryable ? 'Yes' : 'No'}</Text>
          {error.action && <Text>Action: {error.action}</Text>}
        </View>
      )}
    </View>
  );
}

// ============================================================================
// Example 7: Complete Flow with All Features
// ============================================================================

export function CompleteExample() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UserFriendlyError | null>(null);
  const { isOnline } = useOfflineMode();
  
  const fetchData = async () => {
    if (!isOnline) {
      setError({
        type: 'network',
        title: 'No Connection',
        message: 'Cannot fetch data while offline. Please check your connection.',
        retryable: true,
      });
      return;
    }
    
    setLoading(true);
    setError(null);
    
    const result = await handleServiceError(
      async () => {
        return await retryOperation(
          async () => {
            const response = await fetch('/api/data');
            if (!response.ok) throw new Error('Failed to fetch');
            return response.json();
          },
          { maxAttempts: 3, initialDelayMs: 1000 }
        );
      },
      { operation: 'fetchData', retryable: true }
    );
    
    setLoading(false);
    
    if (result.success) {
      setData(result.data);
    } else {
      setError(result.error);
    }
  };
  
  return (
    <ErrorBoundary>
      <View style={{ padding: 16 }}>
        {/* Offline indicator */}
        {!isOnline && (
          <Text style={{ color: '#c00', marginBottom: 10 }}>
            ⚠️ You're offline
          </Text>
        )}
        
        {/* Error banner */}
        {error && (
          <ErrorBanner
            error={error}
            onDismiss={() => setError(null)}
            onAction={fetchData}
          />
        )}
        
        {/* Loading state */}
        {loading && (
          <ActivityIndicator size="large" />
        )}
        
        {/* Data display */}
        {data && !loading && (
          <View>
            <Text>Data loaded successfully!</Text>
            <Text>{JSON.stringify(data, null, 2)}</Text>
          </View>
        )}
        
        {/* Action button */}
        {!loading && (
          <TouchableOpacity onPress={fetchData}>
            <Text>Load Data</Text>
          </TouchableOpacity>
        )}
      </View>
    </ErrorBoundary>
  );
}
