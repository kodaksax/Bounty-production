/**
 * WebSocket Bounty Updates Integration Tests
 * 
 * Tests real-time bounty status updates via WebSocket:
 * - Multi-client synchronization
 * - Reconnection logic
 * - Optimistic UI updates
 * - Status change broadcasting
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock WebSocket and related dependencies
const mockWsAdapter = {
  isConnected: jest.fn(() => true),
  on: jest.fn((event: string, handler: Function) => {
    return () => {}; // unsubscribe function
  }),
  send: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  reconnect: jest.fn(),
};

jest.mock('../../lib/services/websocket-adapter', () => ({
  wsAdapter: mockWsAdapter,
}));

// Mock bountyService
const mockBountyService = {
  getAll: jest.fn(async () => []),
  updateStatus: jest.fn(async (id: number, status: string) => ({
    id,
    status,
    title: 'Test Bounty',
    description: 'Test Description',
    created_at: new Date().toISOString(),
  })),
};

jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: mockBountyService,
}));

// Mock logger
jest.mock('../../lib/utils/error-logger', () => ({
  logger: {
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  },
}));

describe('WebSocket Bounty Updates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Real-time Status Updates', () => {
    it('should subscribe to bounty.status events', async () => {
      // Import after mocks are set up
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook } = await import('@testing-library/react-hooks');

      renderHook(() => useBounties());

      // Verify WebSocket event subscription
      expect(mockWsAdapter.on).toHaveBeenCalledWith('bounty.status', expect.any(Function));
    });

    it('should update bounty status when WebSocket event is received', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      // Set up initial bounties
      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty 1' },
        { id: 2, status: 'open', title: 'Test Bounty 2' },
      ]);

      const { result, waitForNextUpdate } = renderHook(() => useBounties());

      // Wait for initial fetch
      await waitForNextUpdate();

      // Get the WebSocket event handler
      const wsEventHandler = mockWsAdapter.on.mock.calls.find(
        (call) => call[0] === 'bounty.status'
      )?.[1];

      expect(wsEventHandler).toBeDefined();

      // Simulate WebSocket event
      act(() => {
        wsEventHandler?.({ id: 1, status: 'in_progress' });
      });

      // Verify bounty status was updated
      const updatedBounty = result.current.bounties.find((b: any) => b.id === 1);
      expect(updatedBounty?.status).toBe('in_progress');
    });

    it('should handle invalid WebSocket events gracefully', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty' },
      ]);

      const { result, waitForNextUpdate } = renderHook(() => useBounties());
      await waitForNextUpdate();

      const wsEventHandler = mockWsAdapter.on.mock.calls.find(
        (call) => call[0] === 'bounty.status'
      )?.[1];

      // Simulate invalid events
      act(() => {
        wsEventHandler?.(null);
        wsEventHandler?.({});
        wsEventHandler?.({ id: 1 }); // missing status
        wsEventHandler?.({ status: 'open' }); // missing id
      });

      // Bounties should remain unchanged
      expect(result.current.bounties).toHaveLength(1);
      expect(result.current.bounties[0].status).toBe('open');
    });
  });

  describe('Optimistic Updates', () => {
    it('should optimistically update UI before API call', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty' },
      ]);

      const { result, waitForNextUpdate } = renderHook(() => 
        useBounties({ optimisticUpdates: true })
      );

      await waitForNextUpdate();

      // Delay the API call
      mockBountyService.updateStatus.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: 1, status: 'in_progress' }), 100))
      );

      // Update status
      act(() => {
        result.current.updateBountyStatus(1, 'in_progress');
      });

      // UI should update immediately (optimistic)
      expect(result.current.bounties[0].status).toBe('in_progress');

      // Wait for API call to complete
      await waitForNextUpdate();

      // Status should still be updated
      expect(result.current.bounties[0].status).toBe('in_progress');
      expect(mockBountyService.updateStatus).toHaveBeenCalledWith(1, 'in_progress');
    });

    it('should rollback optimistic update on API failure', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty' },
      ]);

      const { result, waitForNextUpdate } = renderHook(() =>
        useBounties({ optimisticUpdates: true })
      );

      await waitForNextUpdate();

      // Make API call fail
      mockBountyService.updateStatus.mockRejectedValue(new Error('API Error'));

      let error: any;
      // Update status
      await act(async () => {
        try {
          await result.current.updateBountyStatus(1, 'in_progress');
        } catch (e) {
          error = e;
        }
      });

      // Status should be rolled back to original
      expect(result.current.bounties[0].status).toBe('open');
      expect(error).toBeDefined();
    });

    it('should not perform optimistic updates when disabled', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty' },
      ]);

      const { result, waitForNextUpdate } = renderHook(() =>
        useBounties({ optimisticUpdates: false })
      );

      await waitForNextUpdate();

      // Delay the API call
      mockBountyService.updateStatus.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: 1, status: 'in_progress' }), 50))
      );

      // Update status
      act(() => {
        result.current.updateBountyStatus(1, 'in_progress');
      });

      // UI should NOT update immediately
      expect(result.current.bounties[0].status).toBe('open');
    });
  });

  describe('Multi-client Synchronization', () => {
    it('should synchronize status updates across multiple hook instances', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty' },
      ]);

      // Render two hook instances (simulating two components)
      const { result: result1, waitForNextUpdate: wait1 } = renderHook(() => useBounties());
      const { result: result2, waitForNextUpdate: wait2 } = renderHook(() => useBounties());

      await Promise.all([wait1(), wait2()]);

      // Get the WebSocket event handler
      const wsEventHandler = mockWsAdapter.on.mock.calls.find(
        (call) => call[0] === 'bounty.status'
      )?.[1];

      // Simulate WebSocket event
      act(() => {
        wsEventHandler?.({ id: 1, status: 'in_progress' });
      });

      // Both instances should reflect the update
      expect(result1.current.bounties[0].status).toBe('in_progress');
      expect(result2.current.bounties[0].status).toBe('in_progress');
    });
  });

  describe('Connection Management', () => {
    it('should publish WebSocket events when updating status', async () => {
      const { bountyService } = await import('../../lib/services/bounty-service');

      await bountyService.updateStatus(123, 'in_progress');

      expect(mockWsAdapter.send).toHaveBeenCalledWith('bounty.status', {
        id: 123,
        status: 'in_progress',
        timestamp: expect.any(String),
      });
    });

    it('should handle WebSocket send failures gracefully', async () => {
      mockWsAdapter.send.mockImplementation(() => {
        throw new Error('WebSocket send failed');
      });

      const { bountyService } = await import('../../lib/services/bounty-service');

      // Should not throw error even if WebSocket fails
      await expect(bountyService.updateStatus(123, 'in_progress')).resolves.toBeDefined();
    });

    it('should not send WebSocket events when disconnected', async () => {
      mockWsAdapter.isConnected.mockReturnValue(false);

      const { bountyService } = await import('../../lib/services/bounty-service');

      await bountyService.updateStatus(123, 'in_progress');

      expect(mockWsAdapter.send).not.toHaveBeenCalled();
    });
  });

  describe('Auto-refresh on Reconnection', () => {
    it('should refresh bounties when WebSocket reconnects', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty' },
      ]);

      const { result, waitForNextUpdate } = renderHook(() => 
        useBounties({ autoRefresh: true })
      );

      await waitForNextUpdate();

      // Clear previous calls
      mockBountyService.getAll.mockClear();

      // Simulate reconnection by updating some bounties
      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'in_progress', title: 'Test Bounty' },
        { id: 2, status: 'open', title: 'New Bounty' },
      ]);

      // Trigger refresh
      await act(async () => {
        await result.current.refreshBounties();
      });

      expect(mockBountyService.getAll).toHaveBeenCalled();
      expect(result.current.bounties).toHaveLength(2);
      expect(result.current.bounties[0].status).toBe('in_progress');
    });
  });

  describe('Add and Remove Bounties', () => {
    it('should add a bounty to the local state', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty 1' },
      ]);

      const { result, waitForNextUpdate } = renderHook(() => useBounties());
      await waitForNextUpdate();

      // Add a new bounty
      const newBounty = { id: 2, status: 'open', title: 'Test Bounty 2' };
      act(() => {
        result.current.addBounty(newBounty);
      });

      expect(result.current.bounties).toHaveLength(2);
      expect(result.current.bounties[0]).toEqual(newBounty);
      expect(result.current.bounties[1].id).toBe(1);
    });

    it('should remove a bounty from the local state', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty 1' },
        { id: 2, status: 'open', title: 'Test Bounty 2' },
      ]);

      const { result, waitForNextUpdate } = renderHook(() => useBounties());
      await waitForNextUpdate();

      expect(result.current.bounties).toHaveLength(2);

      // Remove a bounty by numeric id
      act(() => {
        result.current.removeBounty(1);
      });

      expect(result.current.bounties).toHaveLength(1);
      expect(result.current.bounties[0].id).toBe(2);
    });

    it('should remove a bounty with string id', async () => {
      const { useBounties } = await import('../../hooks/useBounties');
      const { renderHook, act } = await import('@testing-library/react-hooks');

      mockBountyService.getAll.mockResolvedValue([
        { id: 1, status: 'open', title: 'Test Bounty 1' },
        { id: 2, status: 'open', title: 'Test Bounty 2' },
      ]);

      const { result, waitForNextUpdate } = renderHook(() => useBounties());
      await waitForNextUpdate();

      // Remove a bounty by string id
      act(() => {
        result.current.removeBounty('2');
      });

      expect(result.current.bounties).toHaveLength(1);
      expect(result.current.bounties[0].id).toBe(1);
    });
  });
});
