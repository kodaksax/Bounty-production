/**
 * Unit tests for Performance Monitor Utilities
 */

import {
  performanceMonitor,
  trackAsyncPerformance,
  logMemoryUsage,
} from '../../../lib/utils/performance-monitor';

// Mock performance.now() for consistent testing
const mockPerformanceNow = jest.fn();
let originalPerformanceNow: () => number;

// Mock console methods to verify logging behavior
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();

// Mock __DEV__ global
(global as any).__DEV__ = true;

// Setup and teardown for performance.now mock
beforeAll(() => {
  // Save original performance.now
  originalPerformanceNow = global.performance.now.bind(global.performance);
  
  // Replace performance.now with mock using Object.defineProperty since it's read-only
  Object.defineProperty(global.performance, 'now', {
    writable: true,
    configurable: true,
    value: mockPerformanceNow,
  });
});

afterAll(() => {
  // Restore original performance.now
  Object.defineProperty(global.performance, 'now', {
    writable: true,
    configurable: true,
    value: originalPerformanceNow,
  });
});

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    // Clear all metrics and reset mocks before each test
    performanceMonitor.clear();
    mockPerformanceNow.mockClear();
    mockConsoleLog.mockClear();
    mockConsoleWarn.mockClear();
    
    // Reset performance.now() to return incrementing values
    let counter = 0;
    mockPerformanceNow.mockImplementation(() => {
      counter += 10;
      return counter;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('start and end', () => {
    it('should start tracking a metric', () => {
      mockPerformanceNow.mockReturnValue(100);
      performanceMonitor.start('test-metric');
      
      const metric = performanceMonitor.getMetric('test-metric');
      expect(metric).toBeDefined();
      expect(metric?.name).toBe('test-metric');
      expect(metric?.startTime).toBe(100);
    });

    it('should end tracking a metric and calculate duration', () => {
      mockPerformanceNow.mockReturnValueOnce(100).mockReturnValueOnce(250);
      
      performanceMonitor.start('test-metric');
      const duration = performanceMonitor.end('test-metric');
      
      expect(duration).toBe(150);
      const metric = performanceMonitor.getMetric('test-metric');
      expect(metric?.duration).toBe(150);
      expect(metric?.endTime).toBe(250);
    });

    it('should return null when ending non-existent metric', () => {
      const duration = performanceMonitor.end('non-existent');
      expect(duration).toBeNull();
    });

    it('should log warning for slow operations', () => {
      mockPerformanceNow.mockReturnValueOnce(100).mockReturnValueOnce(1500);
      
      performanceMonitor.start('slow-operation');
      performanceMonitor.end('slow-operation');
      
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Slow operation detected'),
        undefined
      );
    });

    it('should include metadata in metric', () => {
      const metadata = { userId: '123', action: 'fetch' };
      mockPerformanceNow.mockReturnValue(100);
      
      performanceMonitor.start('test-metric', metadata);
      
      const metric = performanceMonitor.getMetric('test-metric');
      expect(metric?.metadata).toEqual(metadata);
    });

    it('should merge additional metadata when ending', () => {
      const initialMetadata = { userId: '123' };
      const additionalMetadata = { success: true };
      
      mockPerformanceNow.mockReturnValueOnce(100).mockReturnValueOnce(200);
      
      performanceMonitor.start('test-metric', initialMetadata);
      performanceMonitor.end('test-metric', additionalMetadata);
      
      const metric = performanceMonitor.getMetric('test-metric');
      expect(metric?.metadata).toEqual({ ...initialMetadata, ...additionalMetadata });
    });
  });

  describe('setEnabled', () => {
    it('should not track metrics when disabled', () => {
      performanceMonitor.setEnabled(false);
      performanceMonitor.start('test-metric');
      
      const metric = performanceMonitor.getMetric('test-metric');
      expect(metric).toBeUndefined();
    });

    it('should track metrics when enabled', () => {
      performanceMonitor.setEnabled(true);
      mockPerformanceNow.mockReturnValue(100);
      
      performanceMonitor.start('test-metric');
      
      const metric = performanceMonitor.getMetric('test-metric');
      expect(metric).toBeDefined();
    });
  });

  describe('getAllMetrics', () => {
    it('should return all tracked metrics', () => {
      mockPerformanceNow.mockReturnValue(100);
      
      performanceMonitor.start('metric1');
      performanceMonitor.start('metric2');
      performanceMonitor.start('metric3');
      
      const metrics = performanceMonitor.getAllMetrics();
      expect(metrics).toHaveLength(3);
      expect(metrics.map(m => m.name)).toEqual(['metric1', 'metric2', 'metric3']);
    });

    it('should return empty array when no metrics tracked', () => {
      const metrics = performanceMonitor.getAllMetrics();
      expect(metrics).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should remove all metrics', () => {
      mockPerformanceNow.mockReturnValue(100);
      
      performanceMonitor.start('metric1');
      performanceMonitor.start('metric2');
      
      expect(performanceMonitor.getAllMetrics()).toHaveLength(2);
      
      performanceMonitor.clear();
      
      expect(performanceMonitor.getAllMetrics()).toHaveLength(0);
    });
  });

  describe('getSummary', () => {
    it('should return summary statistics', () => {
      mockPerformanceNow
        .mockReturnValueOnce(0).mockReturnValueOnce(500)   // metric1: 500ms
        .mockReturnValueOnce(0).mockReturnValueOnce(1500)  // metric2: 1500ms (slow)
        .mockReturnValueOnce(0).mockReturnValueOnce(300);  // metric3: 300ms
      
      performanceMonitor.start('metric1');
      performanceMonitor.end('metric1');
      
      performanceMonitor.start('metric2');
      performanceMonitor.end('metric2');
      
      performanceMonitor.start('metric3');
      performanceMonitor.end('metric3');
      
      const summary = performanceMonitor.getSummary();
      
      expect(summary.totalMetrics).toBe(3);
      expect(summary.slowMetrics).toHaveLength(1);
      expect(summary.slowMetrics[0].name).toBe('metric2');
      expect(summary.averageDuration).toBeCloseTo(766.67, 1);
    });

    it('should handle empty metrics', () => {
      const summary = performanceMonitor.getSummary();
      
      expect(summary.totalMetrics).toBe(0);
      expect(summary.slowMetrics).toHaveLength(0);
      expect(summary.averageDuration).toBe(0);
    });
  });
});

describe('React hooks and HOCs', () => {
  // Note: useRenderPerformance and withScreenPerformance are React-specific utilities
  // that rely on React lifecycle methods. They are tested in integration tests or
  // through actual component usage. Unit testing these requires a full React environment
  // which is outside the scope of these utility tests.
  
  it('should export useRenderPerformance function', () => {
    const { useRenderPerformance } = require('../../../lib/utils/performance-monitor');
    expect(typeof useRenderPerformance).toBe('function');
  });

  it('should export withScreenPerformance function', () => {
    const { withScreenPerformance } = require('../../../lib/utils/performance-monitor');
    expect(typeof withScreenPerformance).toBe('function');
  });
});

describe('trackAsyncPerformance', () => {
  beforeEach(() => {
    mockPerformanceNow.mockClear();
    mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(150);
  });

  it('should track successful async operations', async () => {
    const asyncFn = jest.fn().mockResolvedValue('success');
    const tracked = trackAsyncPerformance('fetchData', asyncFn);
    
    const result = await tracked();
    
    expect(result).toBe('success');
    expect(asyncFn).toHaveBeenCalled();
    
    const metric = performanceMonitor.getMetric('fetchData');
    expect(metric).toBeDefined();
    expect(metric?.metadata?.success).toBe(true);
  });

  it('should track failed async operations', async () => {
    const error = new Error('Failed');
    const asyncFn = jest.fn().mockRejectedValue(error);
    const tracked = trackAsyncPerformance('fetchData', asyncFn);
    
    await expect(tracked()).rejects.toThrow('Failed');
    
    const metric = performanceMonitor.getMetric('fetchData');
    expect(metric).toBeDefined();
    expect(metric?.metadata?.success).toBe(false);
    expect(metric?.metadata?.error).toBe('Error: Failed');
  });

  it('should include custom metadata', async () => {
    const metadata = { endpoint: '/api/users' };
    const asyncFn = jest.fn().mockResolvedValue('data');
    const tracked = trackAsyncPerformance('fetchData', asyncFn, metadata);
    
    await tracked();
    
    const metric = performanceMonitor.getMetric('fetchData');
    expect(metric?.metadata).toMatchObject(metadata);
    expect(metric?.metadata?.success).toBe(true);
  });

  it('should pass arguments to wrapped function', async () => {
    const asyncFn = jest.fn().mockResolvedValue('result');
    const tracked = trackAsyncPerformance('fetchData', asyncFn);
    
    await tracked('arg1', 'arg2', 123);
    
    expect(asyncFn).toHaveBeenCalledWith('arg1', 'arg2', 123);
  });
});

describe('logMemoryUsage', () => {
  it('should log memory usage when available', () => {
    // Mock performance.memory (Chrome-specific)
    (global.performance as any).memory = {
      usedJSHeapSize: 50 * 1048576,  // 50MB
      totalJSHeapSize: 100 * 1048576, // 100MB
      jsHeapSizeLimit: 200 * 1048576, // 200MB
    };
    
    logMemoryUsage('test');
    
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('[Memory - test]')
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('50.00MB')
    );
    
    // Cleanup
    delete (global.performance as any).memory;
  });

  it('should handle missing performance.memory gracefully', () => {
    delete (global.performance as any).memory;
    
    // Should not throw
    expect(() => logMemoryUsage()).not.toThrow();
  });

  it('should format memory values correctly', () => {
    (global.performance as any).memory = {
      usedJSHeapSize: 52428800,   // 50MB
      totalJSHeapSize: 104857600,  // 100MB
      jsHeapSizeLimit: 209715200,  // 200MB
    };
    
    logMemoryUsage();
    
    const logCall = mockConsoleLog.mock.calls[0][0];
    expect(logCall).toContain('50.00MB');
    expect(logCall).toContain('100.00MB');
    expect(logCall).toContain('200.00MB');
    
    // Cleanup
    delete (global.performance as any).memory;
  });
});
