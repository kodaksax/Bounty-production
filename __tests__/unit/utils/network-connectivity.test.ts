/**
 * Unit tests for network connectivity utilities
 */

import { getNetworkErrorMessage, checkNetworkConnectivity, ensureNetworkConnectivity } from '../../../lib/utils/network-connectivity';

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
}));

const NetInfo = require('@react-native-community/netinfo');

describe('network-connectivity utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getNetworkErrorMessage', () => {
    it('should return default message for null error', () => {
      const result = getNetworkErrorMessage(null);
      expect(result).toBe('Network request failed');
    });

    it('should return default message for undefined error', () => {
      const result = getNetworkErrorMessage(undefined);
      expect(result).toBe('Network request failed');
    });

    it('should handle TimeoutError by name', () => {
      const error = new Error('Some timeout message');
      error.name = 'TimeoutError';
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Request timed out. Please check your internet connection and try again.');
    });

    it('should handle timeout error by message content', () => {
      const error = new Error('Request timed out after 30 seconds');
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Request timed out. Please check your internet connection and try again.');
    });

    it('should handle NetworkError by name', () => {
      const error = new Error('Network request failed');
      error.name = 'NetworkError';
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Unable to connect. Please check your internet connection.');
    });

    it('should handle network error by message content', () => {
      const error = new Error('Network connection lost');
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Unable to connect. Please check your internet connection.');
    });

    it('should handle fetch failed message', () => {
      const error = new Error('fetch failed');
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Unable to connect. Please check your internet connection.');
    });

    it('should handle AbortError with timeout message', () => {
      const error = new Error('Request timed out');
      error.name = 'AbortError';
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Request timed out. Please check your internet connection and try again.');
    });

    it('should handle AbortError with generic message', () => {
      const error = new Error('Request was cancelled');
      error.name = 'AbortError';
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Connection interrupted. Please try again.');
    });

    it('should handle "Failed to fetch" message', () => {
      const error = new Error('Failed to fetch from server');
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Connection failed. Please check your internet and try again.');
    });

    it('should handle "Load failed" message', () => {
      const error = new Error('Load failed');
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Connection failed. Please check your internet and try again.');
    });

    it('should return original message for unknown error types', () => {
      const error = new Error('Custom error message');
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Custom error message');
    });

    it('should handle non-Error objects with message property', () => {
      const error = { message: 'Plain object error' };
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('Plain object error');
    });

    it('should convert non-Error objects to string', () => {
      const error = 'String error';
      const result = getNetworkErrorMessage(error);
      expect(result).toBe('String error');
    });
  });

  describe('checkNetworkConnectivity', () => {
    it('should return network state when NetInfo succeeds', async () => {
      NetInfo.fetch.mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      });

      const result = await checkNetworkConnectivity();
      
      expect(result).toEqual({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      });
    });

    it('should handle null values from NetInfo', async () => {
      NetInfo.fetch.mockResolvedValueOnce({
        isConnected: null,
        isInternetReachable: null,
        type: 'none',
      });

      const result = await checkNetworkConnectivity();
      
      expect(result).toEqual({
        isConnected: false,
        isInternetReachable: null,
        type: 'none',
      });
    });

    it('should return default state on NetInfo error', async () => {
      NetInfo.fetch.mockRejectedValueOnce(new Error('NetInfo unavailable'));

      const result = await checkNetworkConnectivity();
      
      expect(result).toEqual({
        isConnected: true,
        isInternetReachable: null,
        type: null,
      });
    });
  });

  describe('ensureNetworkConnectivity', () => {
    it('should not throw when connected', async () => {
      NetInfo.fetch.mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      });

      await expect(ensureNetworkConnectivity()).resolves.toBeUndefined();
    });

    it('should throw NetworkError when not connected', async () => {
      NetInfo.fetch.mockResolvedValueOnce({
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
      });

      await expect(ensureNetworkConnectivity()).rejects.toThrow('No internet connection');
    });

    it('should throw NetworkError when internet not reachable', async () => {
      NetInfo.fetch.mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: false,
        type: 'wifi',
      });

      await expect(ensureNetworkConnectivity()).rejects.toThrow('Connected to network but internet is not reachable');
    });

    it('should pass when isInternetReachable is null but isConnected is true', async () => {
      NetInfo.fetch.mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: null,
        type: 'cellular',
      });

      await expect(ensureNetworkConnectivity()).resolves.toBeUndefined();
    });
  });
});
