/**
 * Unit tests for NetworkProvider
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import { NetworkProvider, useNetworkContext, useOptionalNetworkContext } from '../../../providers/network-provider';

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  }),
  addEventListener: jest.fn().mockReturnValue(() => {}),
}));

const NetInfo = require('@react-native-community/netinfo');

// Test component that reads network context
function NetworkConsumer() {
  const { isConnected, isInternetReachable, connectionType, isChecking } = useNetworkContext();
  return (
    <>
      <Text testID="isConnected">{String(isConnected)}</Text>
      <Text testID="isInternetReachable">{String(isInternetReachable)}</Text>
      <Text testID="connectionType">{String(connectionType)}</Text>
      <Text testID="isChecking">{String(isChecking)}</Text>
    </>
  );
}

// Test component that uses optional context
function OptionalConsumer() {
  const ctx = useOptionalNetworkContext();
  return <Text testID="hasContext">{String(ctx !== undefined)}</Text>;
}

describe('NetworkProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NetInfo.fetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
    });
  });

  it('should provide initial connected state', async () => {
    const { getByTestId } = render(
      <NetworkProvider>
        <NetworkConsumer />
      </NetworkProvider>
    );

    // Default state before NetInfo resolves
    expect(getByTestId('isConnected').props.children).toBe('true');
  });

  it('should fetch initial network state on mount', async () => {
    render(
      <NetworkProvider>
        <NetworkConsumer />
      </NetworkProvider>
    );

    expect(NetInfo.fetch).toHaveBeenCalledTimes(1);
  });

  it('should subscribe to NetInfo changes on mount', () => {
    render(
      <NetworkProvider>
        <NetworkConsumer />
      </NetworkProvider>
    );

    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
    expect(typeof NetInfo.addEventListener.mock.calls[0][0]).toBe('function');
  });

  it('should unsubscribe from NetInfo on unmount', () => {
    const unsubscribe = jest.fn();
    NetInfo.addEventListener.mockReturnValueOnce(unsubscribe);

    const { unmount } = render(
      <NetworkProvider>
        <NetworkConsumer />
      </NetworkProvider>
    );

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should update state when NetInfo listener fires', async () => {
    // Override addEventListener to capture the listener
    let listener: ((state: any) => void) | undefined;
    const unsubscribe = jest.fn();
    NetInfo.addEventListener.mockImplementationOnce((cb: any) => {
      listener = cb;
      return unsubscribe;
    });

    const { getByTestId } = render(
      <NetworkProvider>
        <NetworkConsumer />
      </NetworkProvider>
    );

    // Wait for initial fetch to settle
    await act(async () => {
      await Promise.resolve();
    });

    // Simulate going offline
    await act(async () => {
      listener?.({
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
      });
    });

    expect(getByTestId('isConnected').props.children).toBe('false');
    expect(getByTestId('connectionType').props.children).toBe('none');
  });

  it('should handle manual checkConnection', async () => {
    let checkFn: (() => Promise<void>) | undefined;

    function CheckConsumer() {
      const { checkConnection, isChecking } = useNetworkContext();
      checkFn = checkConnection;
      return <Text testID="isChecking">{String(isChecking)}</Text>;
    }

    render(
      <NetworkProvider>
        <CheckConsumer />
      </NetworkProvider>
    );

    // Trigger manual check
    await act(async () => {
      await checkFn?.();
    });

    // fetch should have been called again (initial + manual)
    expect(NetInfo.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw when useNetworkContext is used outside provider', () => {
    // Suppress console.error for expected React error
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<NetworkConsumer />);
    }).toThrow('useNetworkContext must be used within a NetworkProvider');

    consoleSpy.mockRestore();
  });

  it('should return undefined for useOptionalNetworkContext outside provider', () => {
    const { getByTestId } = render(<OptionalConsumer />);
    expect(getByTestId('hasContext').props.children).toBe('false');
  });

  it('should return context for useOptionalNetworkContext inside provider', () => {
    const { getByTestId } = render(
      <NetworkProvider>
        <OptionalConsumer />
      </NetworkProvider>
    );
    expect(getByTestId('hasContext').props.children).toBe('true');
  });

  it('should handle NetInfo.fetch rejection gracefully', async () => {
    NetInfo.fetch.mockRejectedValueOnce(new Error('NetInfo unavailable'));

    const { getByTestId } = render(
      <NetworkProvider>
        <NetworkConsumer />
      </NetworkProvider>
    );

    // Should default to connected (optimistic) when fetch fails
    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('isConnected').props.children).toBe('true');
  });

  it('should handle connected but internet unreachable', async () => {
    NetInfo.fetch.mockResolvedValueOnce({
      isConnected: true,
      isInternetReachable: false,
      type: 'wifi',
    });

    const { getByTestId } = render(
      <NetworkProvider>
        <NetworkConsumer />
      </NetworkProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('isConnected').props.children).toBe('true');
    expect(getByTestId('isInternetReachable').props.children).toBe('false');
  });

  it('should reflect cellular connection type', async () => {
    NetInfo.fetch.mockResolvedValueOnce({
      isConnected: true,
      isInternetReachable: true,
      type: 'cellular',
    });

    const { getByTestId } = render(
      <NetworkProvider>
        <NetworkConsumer />
      </NetworkProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('connectionType').props.children).toBe('cellular');
  });
});
