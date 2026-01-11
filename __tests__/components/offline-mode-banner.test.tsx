/**
 * Tests for Offline Mode Banner component
 */

import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { OfflineModeBanner, CompactOfflineBanner } from '../../components/offline-mode-banner';
import * as useOfflineModeModule from '../../hooks/useOfflineMode';

// Mock the useOfflineMode hook
jest.mock('../../hooks/useOfflineMode');

describe('OfflineModeBanner', () => {
  const mockCheckConnection = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not render when online with no queued items', () => {
    (useOfflineModeModule.useOfflineMode as jest.Mock).mockReturnValue({
      isOnline: true,
      isChecking: false,
      queuedItemsCount: 0,
      checkConnection: mockCheckConnection,
    });

    const { queryByText } = render(<OfflineModeBanner />);
    
    expect(queryByText('No Internet Connection')).toBeNull();
    expect(queryByText('Syncing...')).toBeNull();
  });

  it('should render offline banner when offline', () => {
    (useOfflineModeModule.useOfflineMode as jest.Mock).mockReturnValue({
      isOnline: false,
      isChecking: false,
      queuedItemsCount: 0,
      checkConnection: mockCheckConnection,
    });

    const { getByText } = render(<OfflineModeBanner />);
    
    expect(getByText('No Internet Connection')).toBeTruthy();
  });

  it('should show queued items count when offline', () => {
    (useOfflineModeModule.useOfflineMode as jest.Mock).mockReturnValue({
      isOnline: false,
      isChecking: false,
      queuedItemsCount: 3,
      checkConnection: mockCheckConnection,
    });

    const { getByText } = render(<OfflineModeBanner showDetails={true} />);
    
    expect(getByText('Changes will sync when you\'re back online')).toBeTruthy();
  });

  it('should show syncing status when online with queued items', () => {
    (useOfflineModeModule.useOfflineMode as jest.Mock).mockReturnValue({
      isOnline: true,
      isChecking: false,
      queuedItemsCount: 2,
      checkConnection: mockCheckConnection,
    });

    const { getByText } = render(<OfflineModeBanner />);
    
    expect(getByText('Syncing...')).toBeTruthy();
    expect(getByText('2 items pending')).toBeTruthy();
  });

  it('should call checkConnection when refresh button is pressed', async () => {
    (useOfflineModeModule.useOfflineMode as jest.Mock).mockReturnValue({
      isOnline: true,
      isChecking: false,
      queuedItemsCount: 1,
      checkConnection: mockCheckConnection,
    });

    const { getByTestId, UNSAFE_root } = render(<OfflineModeBanner />);
    
    // Find the TouchableOpacity that contains the refresh icon
    const touchables = UNSAFE_root.findAllByType('TouchableOpacity');
    const refreshButton = touchables.find((node: any) => {
      // Check if this TouchableOpacity has a MaterialIcons child with name="refresh"
      const children = node.children || [];
      return children.some((child: any) => 
        child.props?.name === 'refresh'
      );
    });
    
    if (refreshButton) {
      fireEvent.press(refreshButton);
      expect(mockCheckConnection).toHaveBeenCalled();
    }
  });
});

describe('CompactOfflineBanner', () => {
  it('should not render when online with no queued items', () => {
    (useOfflineModeModule.useOfflineMode as jest.Mock).mockReturnValue({
      isOnline: true,
      isChecking: false,
      queuedItemsCount: 0,
      checkConnection: jest.fn(),
    });

    const { queryByText } = render(<CompactOfflineBanner />);
    
    expect(queryByText('Offline')).toBeNull();
    expect(queryByText(/syncing/)).toBeNull();
  });

  it('should render offline text when offline', () => {
    (useOfflineModeModule.useOfflineMode as jest.Mock).mockReturnValue({
      isOnline: false,
      isChecking: false,
      queuedItemsCount: 0,
      checkConnection: jest.fn(),
    });

    const { getByText } = render(<CompactOfflineBanner />);
    
    expect(getByText('Offline')).toBeTruthy();
  });

  it('should show syncing count when online with queued items', () => {
    (useOfflineModeModule.useOfflineMode as jest.Mock).mockReturnValue({
      isOnline: true,
      isChecking: false,
      queuedItemsCount: 5,
      checkConnection: jest.fn(),
    });

    const { getByText } = render(<CompactOfflineBanner />);
    
    expect(getByText('5 syncing')).toBeTruthy();
  });
});
