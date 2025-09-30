/**
 * API Client Demo Component
 * 
 * This is a simple demonstration of the API client integration
 * showing how the four core methods work in a React Native context.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, StyleSheet } from 'react-native';
import { BountyApiService } from '../lib/services/api-client-integration';

interface DemoState {
  loading: boolean;
  result: string;
  error: string | null;
}

export function ApiClientDemo() {
  const [state, setState] = useState<DemoState>({
    loading: false,
    result: '',
    error: null,
  });

  const setLoading = (loading: boolean) => {
    setState(prev => ({ ...prev, loading }));
  };

  const setResult = (result: string, error: string | null = null) => {
    setState({ loading: false, result, error });
  };

  /**
   * Demo: Get bounties
   */
  const handleGetBounties = async () => {
    setLoading(true);
    try {
      const { bounties, error } = await BountyApiService.getBounties({
        status: 'open',
        limit: 5,
      });

      if (error) {
        setResult('', error);
      } else {
        setResult(`Found ${bounties.length} bounties:\n${JSON.stringify(bounties, null, 2)}`);
      }
    } catch (err) {
      setResult('', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  /**
   * Demo: Create bounty
   */
  const handleCreateBounty = async () => {
    setLoading(true);
    try {
      const { bounty, error } = await BountyApiService.createBounty({
        title: 'Sample Bounty from API Client',
        description: 'This bounty was created using the new typed API client',
        amount: 75,
        is_for_honor: false,
        work_type: 'online',
        timeline: '2 weeks',
        skills_required: 'React Native, TypeScript, API Integration',
      });

      if (error) {
        setResult('', error);
      } else {
        setResult(`Bounty created successfully:\n${JSON.stringify(bounty, null, 2)}`);
      }
    } catch (err) {
      setResult('', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  /**
   * Demo: Accept bounty
   */
  const handleAcceptBounty = async () => {
    setLoading(true);
    try {
      // Using a sample bounty ID - in a real app this would come from props or state
      const sampleBountyId = 1;
      const { request, error } = await BountyApiService.acceptBounty(
        sampleBountyId,
        'I am interested in working on this bounty and have the required skills!'
      );

      if (error) {
        setResult('', error);
      } else {
        setResult(`Bounty request submitted:\n${JSON.stringify(request, null, 2)}`);
      }
    } catch (err) {
      setResult('', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  /**
   * Demo: Complete bounty
   */
  const handleCompleteBounty = async () => {
    setLoading(true);
    try {
      // Using a sample bounty ID - in a real app this would come from props or state
      const sampleBountyId = 1;
      const { bounty, error } = await BountyApiService.completeBounty(
        sampleBountyId,
        'Task completed successfully! All requirements have been met and tested thoroughly.'
      );

      if (error) {
        setResult('', error);
      } else {
        setResult(`Bounty completed:\n${JSON.stringify(bounty, null, 2)}`);
      }
    } catch (err) {
      setResult('', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const showAlert = (title: string, message: string) => {
    Alert.alert(title, message);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>API Client Demo</Text>
      <Text style={styles.description}>
        This demonstrates the four core API client methods:
        getBounties, createBounty, acceptBounty, and completeBounty
      </Text>

      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, styles.getBountiesButton]} 
          onPress={handleGetBounties}
          disabled={state.loading}
        >
          <Text style={styles.buttonText}>
            {state.loading ? 'Loading...' : 'Get Bounties'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.button, styles.createButton]} 
          onPress={handleCreateBounty}
          disabled={state.loading}
        >
          <Text style={styles.buttonText}>
            {state.loading ? 'Creating...' : 'Create Bounty'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.button, styles.acceptButton]} 
          onPress={handleAcceptBounty}
          disabled={state.loading}
        >
          <Text style={styles.buttonText}>
            {state.loading ? 'Accepting...' : 'Accept Bounty (ID: 1)'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.button, styles.completeButton]} 
          onPress={handleCompleteBounty}
          disabled={state.loading}
        >
          <Text style={styles.buttonText}>
            {state.loading ? 'Completing...' : 'Complete Bounty (ID: 1)'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Results Display */}
      <View style={styles.resultContainer}>
        <Text style={styles.resultHeader}>Result:</Text>
        
        {state.error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {state.error}</Text>
            <TouchableOpacity 
              style={styles.alertButton}
              onPress={() => showAlert('Error Details', state.error || 'Unknown error')}
            >
              <Text style={styles.alertButtonText}>Show Details</Text>
            </TouchableOpacity>
          </View>
        ) : state.result ? (
          <ScrollView style={styles.resultScrollView}>
            <Text style={styles.resultText}>{state.result}</Text>
          </ScrollView>
        ) : (
          <Text style={styles.placeholderText}>Click a button to test the API client</Text>
        )}
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.infoTitle}>Features Demonstrated:</Text>
        <Text style={styles.infoText}>• Typed API responses</Text>
        <Text style={styles.infoText}>• Error handling with 401 refresh strategy placeholder</Text>
        <Text style={styles.infoText}>• Loading states</Text>
        <Text style={styles.infoText}>• Request/response logging</Text>
        <Text style={styles.infoText}>• Integration with existing service patterns</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonContainer: {
    marginBottom: 20,
  },
  button: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  getBountiesButton: {
    backgroundColor: '#0a7ea4',
  },
  createButton: {
    backgroundColor: '#10b981',
  },
  acceptButton: {
    backgroundColor: '#f59e0b',
  },
  completeButton: {
    backgroundColor: '#8b5cf6',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  resultContainer: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    minHeight: 200,
  },
  resultHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  resultScrollView: {
    maxHeight: 300,
  },
  resultText: {
    fontSize: 14,
    color: '#333',
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  placeholderText: {
    fontSize: 16,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 40,
  },
  errorContainer: {
    backgroundColor: '#fee2e2',
    padding: 12,
    borderRadius: 6,
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    marginBottom: 8,
  },
  alertButton: {
    backgroundColor: '#ef4444',
    padding: 8,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  alertButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  infoContainer: {
    backgroundColor: '#e0f2fe',
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#0a7ea4',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0a7ea4',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#0a7ea4',
    marginBottom: 4,
  },
});

export default ApiClientDemo;