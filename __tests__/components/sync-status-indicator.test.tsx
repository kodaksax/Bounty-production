/**
 * Tests for Sync Status Indicator component
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { SyncStatusIndicator, SyncStatusBadge } from '../../components/sync-status-indicator';
import * as useOfflineQueueModule from '../../hooks/useOfflineQueue';

// Mock the useOfflineQueue hook
jest.mock('../../hooks/useOfflineQueue');

describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not render when online with no pending or failed items', () => {
    (useOfflineQueueModule.useOfflineQueue as jest.Mock).mockReturnValue({
      pendingCount: 0,
      failedCount: 0,
      isOnline: true,
      queue: [],
      hasPending: false,
      retryItem: jest.fn(),
      removeItem: jest.fn(),
      clearFailed: jest.fn(),
    });

    const { container } = render(<SyncStatusIndicator />);
    
    expect(container.children.length).toBe(0);
  });

  it('should show syncing state when online with pending items', () => {
    (useOfflineQueueModule.useOfflineQueue as jest.Mock).mockReturnValue({
      pendingCount: 3,
      failedCount: 0,
      isOnline: true,
      queue: [],
      hasPending: true,
      retryItem: jest.fn(),
      removeItem: jest.fn(),
      clearFailed: jest.fn(),
    });

    const { getByText } = render(<SyncStatusIndicator detailed={true} />);
    
    expect(getByText('Syncing 3 items')).toBeTruthy();
  });

  it('should show error state when there are failed items', () => {
    (useOfflineQueueModule.useOfflineQueue as jest.Mock).mockReturnValue({
      pendingCount: 0,
      failedCount: 2,
      isOnline: true,
      queue: [],
      hasPending: false,
      retryItem: jest.fn(),
      removeItem: jest.fn(),
      clearFailed: jest.fn(),
    });

    const { getByText } = render(<SyncStatusIndicator detailed={true} />);
    
    expect(getByText('2 failed')).toBeTruthy();
  });

  it('should show pending state when offline with items', () => {
    (useOfflineQueueModule.useOfflineQueue as jest.Mock).mockReturnValue({
      pendingCount: 5,
      failedCount: 0,
      isOnline: false,
      queue: [],
      hasPending: true,
      retryItem: jest.fn(),
      removeItem: jest.fn(),
      clearFailed: jest.fn(),
    });

    const { getByText } = render(<SyncStatusIndicator detailed={true} />);
    
    expect(getByText('5 pending')).toBeTruthy();
  });

  it('should render without details when detailed=false', () => {
    (useOfflineQueueModule.useOfflineQueue as jest.Mock).mockReturnValue({
      pendingCount: 3,
      failedCount: 0,
      isOnline: true,
      queue: [],
      hasPending: true,
      retryItem: jest.fn(),
      removeItem: jest.fn(),
      clearFailed: jest.fn(),
    });

    const { queryByText } = render(<SyncStatusIndicator detailed={false} />);
    
    expect(queryByText('Syncing 3 items')).toBeNull();
  });
});

describe('SyncStatusBadge', () => {
  it('should not render when no items to sync', () => {
    (useOfflineQueueModule.useOfflineQueue as jest.Mock).mockReturnValue({
      pendingCount: 0,
      failedCount: 0,
      isOnline: true,
      queue: [],
      hasPending: false,
      retryItem: jest.fn(),
      removeItem: jest.fn(),
      clearFailed: jest.fn(),
    });

    const { container } = render(<SyncStatusBadge />);
    
    expect(container.children.length).toBe(0);
  });

  it('should show failed count when there are failed items', () => {
    (useOfflineQueueModule.useOfflineQueue as jest.Mock).mockReturnValue({
      pendingCount: 0,
      failedCount: 2,
      isOnline: true,
      queue: [],
      hasPending: false,
      retryItem: jest.fn(),
      removeItem: jest.fn(),
      clearFailed: jest.fn(),
    });

    const { getByText } = render(<SyncStatusBadge />);
    
    expect(getByText('2')).toBeTruthy();
  });

  it('should show pending count when online with pending items', () => {
    (useOfflineQueueModule.useOfflineQueue as jest.Mock).mockReturnValue({
      pendingCount: 7,
      failedCount: 0,
      isOnline: true,
      queue: [],
      hasPending: true,
      retryItem: jest.fn(),
      removeItem: jest.fn(),
      clearFailed: jest.fn(),
    });

    const { getByText } = render(<SyncStatusBadge />);
    
    expect(getByText('7')).toBeTruthy();
  });
});
