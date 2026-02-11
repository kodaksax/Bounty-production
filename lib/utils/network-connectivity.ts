/**
 * Network connectivity utilities
 * 
 * Provides utilities to check network connectivity before making requests,
 * helping to provide better error messages and avoid unnecessary timeout delays.
 */

import NetInfo from '@react-native-community/netinfo';

export interface NetworkState {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: string | null;
}

/**
 * Check if device has network connectivity
 * 
 * @returns Promise resolving to network state
 */
export async function checkNetworkConnectivity(): Promise<NetworkState> {
  try {
    const state = await NetInfo.fetch();
    return {
      isConnected: state.isConnected ?? false,
      isInternetReachable: state.isInternetReachable ?? null,
      type: state.type,
    };
  } catch (error) {
    console.error('[NetworkConnectivity] Error checking network state:', error);
    // Assume connected if we can't check (don't block the request)
    return {
      isConnected: true,
      isInternetReachable: null,
      type: null,
    };
  }
}

/**
 * Ensure network connectivity before proceeding
 * Throws an error if no network connection is detected
 */
export async function ensureNetworkConnectivity(): Promise<void> {
  const networkState = await checkNetworkConnectivity();
  
  if (!networkState.isConnected) {
    const error = new Error('No internet connection. Please check your network settings and try again.');
    error.name = 'NetworkError';
    throw error;
  }
  
  // Optional: also check if internet is reachable (not just connected to WiFi)
  if (networkState.isInternetReachable === false) {
    const error = new Error('Connected to network but internet is not reachable. Please check your connection.');
    error.name = 'NetworkError';
    throw error;
  }
}

/**
 * Get user-friendly network error message
 */
export function getNetworkErrorMessage(error: any): string {
  if (!error) return 'Network request failed';
  
  const message = error.message || String(error);
  
  // Timeout errors
  if (error.name === 'TimeoutError' || message.includes('timed out') || message.includes('timeout')) {
    return 'Request timed out. Please check your internet connection and try again.';
  }
  
  // Network errors
  if (error.name === 'NetworkError' || message.includes('Network') || message.includes('fetch failed')) {
    return 'Unable to connect. Please check your internet connection.';
  }
  
  // Abort errors
  if (error.name === 'AbortError') {
    return 'Request was cancelled. Please try again.';
  }
  
  // Generic network issues
  if (message.includes('Failed to fetch') || message.includes('Load failed')) {
    return 'Connection failed. Please check your internet and try again.';
  }
  
  return message;
}
