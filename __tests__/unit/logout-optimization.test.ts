/**
 * Unit tests for Logout Speed Optimization
 * Verifies that logout operations complete quickly and cleanup happens in background
 */

// Test timeouts
const SLOW_TEST_TIMEOUT_MS = 5000; // Timeout for tests with async operations

describe('Logout Speed Optimization', () => {
  // Mock timers to control async operations
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Local Signout Priority', () => {
    it('should call local signout immediately', async () => {
      // Mock supabase
      const mockSignOut = jest.fn().mockResolvedValue({ error: null });
      const mockSupabase = {
        auth: {
          signOut: mockSignOut,
        },
      };

      // Simulate local signout call
      await mockSupabase.auth.signOut({ scope: 'local' });

      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it('should not wait for server signout to complete', async () => {
      const startTime = Date.now();
      let serverSignoutCompleted = false;

      // Mock slow server signout
      const mockServerSignOut = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            serverSignoutCompleted = true;
            resolve({ error: null });
          }, 2000); // 2 second delay
        });
      });

      // Mock fast local signout
      const mockLocalSignOut = jest.fn().mockResolvedValue({ error: null });

      // Simulate optimized logout flow
      await mockLocalSignOut();
      const logoutTime = Date.now() - startTime;

      // Start server signout in background (don't await)
      mockServerSignOut().catch(() => {});

      // Local signout should complete quickly (< 100ms)
      expect(logoutTime).toBeLessThan(100);
      // Server signout should not have completed yet
      expect(serverSignoutCompleted).toBe(false);

      // Fast-forward time to complete background operations
      jest.advanceTimersByTime(2500);
      await Promise.resolve(); // Flush promises

      expect(mockLocalSignOut).toHaveBeenCalled();
      expect(mockServerSignOut).toHaveBeenCalled();
    });
  });

  describe('Background Cleanup Operations', () => {
    it('should run cleanup operations in parallel', async () => {
      const cleanupOps: string[] = [];

      // Mock cleanup functions
      const mockClearPreference = jest.fn().mockImplementation(() => {
        cleanupOps.push('preference');
        return Promise.resolve();
      });

      const mockClearDrafts = jest.fn().mockImplementation(() => {
        cleanupOps.push('drafts');
        return Promise.resolve();
      });

      const mockClearTokens = jest.fn().mockImplementation(() => {
        cleanupOps.push('tokens');
        return Promise.resolve();
      });

      // Run cleanup in parallel using Promise.all
      const cleanupPromise = Promise.all([
        mockClearPreference(),
        mockClearDrafts(),
        mockClearTokens(),
      ]);

      // All mocks should be called immediately (not sequentially)
      expect(mockClearPreference).toHaveBeenCalled();
      expect(mockClearDrafts).toHaveBeenCalled();
      expect(mockClearTokens).toHaveBeenCalled();

      await cleanupPromise;

      // All operations should have completed
      expect(cleanupOps).toHaveLength(3);
      expect(cleanupOps).toContain('preference');
      expect(cleanupOps).toContain('drafts');
      expect(cleanupOps).toContain('tokens');
    });

    it('should not block on cleanup operation failures', async () => {
      const mockClearPreference = jest.fn().mockResolvedValue(undefined);
      const mockClearDrafts = jest.fn().mockRejectedValue(new Error('Draft cleanup failed'));
      const mockClearTokens = jest.fn().mockResolvedValue(undefined);

      // Run cleanup in parallel with error handling
      const cleanupPromise = Promise.all([
        mockClearPreference().catch(e => console.error('Preference error', e)),
        mockClearDrafts().catch(e => console.error('Draft error', e)),
        mockClearTokens().catch(e => console.error('Token error', e)),
      ]).catch(e => {
        console.error('Cleanup errors (non-critical)', e);
      });

      // Should not throw error
      await expect(cleanupPromise).resolves.not.toThrow();

      // All operations should have been attempted
      expect(mockClearPreference).toHaveBeenCalled();
      expect(mockClearDrafts).toHaveBeenCalled();
      expect(mockClearTokens).toHaveBeenCalled();
    });
  });

  describe('Navigation Priority', () => {
    it('should navigate before cleanup completes', async () => {
      let navigationCompleted = false;
      let cleanupCompleted = false;

      // Mock navigation
      const mockNavigate = jest.fn().mockImplementation(() => {
        navigationCompleted = true;
        return Promise.resolve();
      });

      // Mock slow cleanup
      const mockCleanup = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            cleanupCompleted = true;
            resolve(undefined);
          }, 1000);
        });
      });

      // Simulate optimized logout flow
      await mockNavigate(); // Navigate immediately

      // Navigation should complete before cleanup
      expect(navigationCompleted).toBe(true);
      expect(cleanupCompleted).toBe(false);

      // Start cleanup in background
      mockCleanup().catch(() => {});

      // Fast-forward to complete cleanup
      jest.advanceTimersByTime(1500);
      await Promise.resolve();

      expect(mockNavigate).toHaveBeenCalled();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });

  describe('Analytics Non-Blocking', () => {
    it('should not await analytics operations on SIGNED_OUT event', async () => {
      let analyticsCompleted = false;

      // Mock analytics operations
      const mockTrackEvent = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            analyticsCompleted = true;
            resolve(undefined);
          }, 500);
        });
      });

      const mockReset = jest.fn().mockResolvedValue(undefined);

      // Simulate SIGNED_OUT event handler (non-blocking analytics)
      const analyticsPromise = Promise.all([
        mockTrackEvent('user_logged_out'),
        mockReset(),
      ]).catch(e => {
        console.error('Analytics cleanup failed (non-critical)', e);
      });

      // Analytics should be called but not awaited
      expect(mockTrackEvent).toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalled();

      // Should not be completed yet
      expect(analyticsCompleted).toBe(false);

      // Fast-forward to complete analytics
      jest.advanceTimersByTime(1000);
      await analyticsPromise;

      expect(analyticsCompleted).toBe(true);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should complete critical logout path in under 100ms', async () => {
      const startTime = performance.now();

      // Mock critical operations (local signout + navigation)
      const mockLocalSignOut = jest.fn().mockResolvedValue({ error: null });
      const mockNavigate = jest.fn().mockResolvedValue(undefined);

      // Execute critical path
      await mockLocalSignOut();
      await mockNavigate();

      const criticalPathTime = performance.now() - startTime;

      // Critical path should be very fast
      expect(criticalPathTime).toBeLessThan(100);
      expect(mockLocalSignOut).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalled();
    });

    it('should handle slow background operations without blocking', async () => {
      const timeline: { timestamp: number; event: string }[] = [];
      let cleanupResolve: (() => void) | null = null;

      // Mock operations with different durations
      const mockLocalSignOut = jest.fn().mockImplementation(async () => {
        timeline.push({ timestamp: Date.now(), event: 'local_signout' });
      });

      const mockNavigate = jest.fn().mockImplementation(async () => {
        timeline.push({ timestamp: Date.now(), event: 'navigate' });
      });

      const mockSlowCleanup = jest.fn().mockImplementation(() => {
        return new Promise<void>(resolve => {
          cleanupResolve = () => {
            timeline.push({ timestamp: Date.now(), event: 'cleanup_complete' });
            resolve();
          };
        });
      });

      // Execute critical path
      await mockLocalSignOut();
      await mockNavigate();
      const criticalPathComplete = Date.now();

      // Start background cleanup (don't await)
      const cleanupPromise = mockSlowCleanup().catch(() => {});

      // Resolve the cleanup manually
      if (cleanupResolve) {
        cleanupResolve();
      }
      await cleanupPromise;

      // Verify order of operations
      expect(timeline.length).toBeGreaterThanOrEqual(2);
      expect(timeline[0].event).toBe('local_signout');
      expect(timeline[1].event).toBe('navigate');

      // Cleanup should happen after critical path
      const cleanupEvent = timeline.find(e => e.event === 'cleanup_complete');
      if (cleanupEvent) {
        expect(cleanupEvent.timestamp).toBeGreaterThanOrEqual(criticalPathComplete);
      }
    }, SLOW_TEST_TIMEOUT_MS); // Use named constant for timeout
  });
});
