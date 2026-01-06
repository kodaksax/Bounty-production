/**
 * Component tests for OfflineStatusBadge
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { OfflineStatusBadge } from '../../components/offline-status-badge';

// Mock expo vector icons
jest.mock('@expo/vector-icons', () => ({
  MaterialIcons: 'MaterialIcons',
}));

// Mock the useOfflineQueue hook
jest.mock('../../hooks/useOfflineQueue', () => ({
  useOfflineQueue: jest.fn(),
}));

const { useOfflineQueue } = require('../../hooks/useOfflineQueue');

describe('OfflineStatusBadge Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render null when online with no pending or failed items', () => {
    useOfflineQueue.mockReturnValue({
      pendingCount: 0,
      failedCount: 0,
      isOnline: true,
    });

    const { queryByText } = render(<OfflineStatusBadge />);

    expect(queryByText(/syncing/i)).toBeNull();
    expect(queryByText(/pending/i)).toBeNull();
    expect(queryByText(/failed/i)).toBeNull();
  });

  it('should display pending count when offline', () => {
    useOfflineQueue.mockReturnValue({
      pendingCount: 3,
      failedCount: 0,
      isOnline: false,
    });

    const { getByText } = render(<OfflineStatusBadge />);

    expect(getByText('3 pending')).toBeTruthy();
  });

  it('should display syncing count when online with pending items', () => {
    useOfflineQueue.mockReturnValue({
      pendingCount: 5,
      failedCount: 0,
      isOnline: true,
    });

    const { getByText } = render(<OfflineStatusBadge />);

    expect(getByText('5 syncing...')).toBeTruthy();
  });

  it('should display failed count when there are failures', () => {
    useOfflineQueue.mockReturnValue({
      pendingCount: 2,
      failedCount: 1,
      isOnline: true,
    });

    const { getByText } = render(<OfflineStatusBadge />);

    expect(getByText('1 failed')).toBeTruthy();
  });

  it('should prioritize showing failed count over pending', () => {
    useOfflineQueue.mockReturnValue({
      pendingCount: 10,
      failedCount: 3,
      isOnline: true,
    });

    const { getByText, queryByText } = render(<OfflineStatusBadge />);

    expect(getByText('3 failed')).toBeTruthy();
    expect(queryByText(/pending/i)).toBeNull();
    expect(queryByText(/syncing/i)).toBeNull();
  });

  it('should render with onPress handler', () => {
    useOfflineQueue.mockReturnValue({
      pendingCount: 1,
      failedCount: 0,
      isOnline: false,
    });

    const onPressMock = jest.fn();
    const { getByText } = render(<OfflineStatusBadge onPress={onPressMock} />);

    const badge = getByText('1 pending');
    expect(badge).toBeTruthy();
  });

  it('should handle zero failed but some pending items', () => {
    useOfflineQueue.mockReturnValue({
      pendingCount: 7,
      failedCount: 0,
      isOnline: false,
    });

    const { getByText } = render(<OfflineStatusBadge />);

    expect(getByText('7 pending')).toBeTruthy();
  });
});
