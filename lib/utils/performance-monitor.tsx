/**
 * Performance Monitoring Utilities
 * 
 * Provides utilities for tracking app performance metrics including:
 * - Screen load times
 * - Component render times
 * - User interaction latency
 * - Memory usage patterns
 */

import React from 'react';

// Performance thresholds (in milliseconds)
const SLOW_OPERATION_THRESHOLD = 1000; // Operations slower than 1s are logged as warnings
const SIXTY_FPS_THRESHOLD = 16.67; // 1000ms / 60fps ≈ 16.67ms per frame

interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private isEnabled: boolean = __DEV__; // Only enable in development by default

  /**
   * Enable or disable performance monitoring
   */
  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  /**
   * Start tracking a performance metric
   */
  start(name: string, metadata?: Record<string, any>) {
    if (!this.isEnabled) return;

    this.metrics.set(name, {
      name,
      startTime: performance.now(),
      metadata,
    });
  }

  /**
   * End tracking a performance metric and calculate duration
   */
  end(name: string, additionalMetadata?: Record<string, any>): number | null {
    if (!this.isEnabled) return null;

    const metric = this.metrics.get(name);
    if (!metric) {
      console.error(`[Performance] No metric found with name: ${name}`);
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - metric.startTime;

    metric.endTime = endTime;
    metric.duration = duration;
    if (additionalMetadata) {
      metric.metadata = { ...metric.metadata, ...additionalMetadata };
    }

    // Log slow operations (>1000ms)
    if (duration > SLOW_OPERATION_THRESHOLD) {
      console.warn(`[Performance] Slow operation detected: ${name} took ${duration.toFixed(2)}ms`, metric.metadata);
    }

    return duration;
  }

  /**
   * Get a specific metric
   */
  getMetric(name: string): PerformanceMetric | undefined {
    return this.metrics.get(name);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): PerformanceMetric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.clear();
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalMetrics: number;
    slowMetrics: PerformanceMetric[];
    averageDuration: number;
  } {
    const completed = Array.from(this.metrics.values()).filter(m => m.duration !== undefined);
    const slow = completed.filter(m => (m.duration || 0) > SLOW_OPERATION_THRESHOLD);
    const avgDuration = completed.length > 0
      ? completed.reduce((sum, m) => sum + (m.duration || 0), 0) / completed.length
      : 0;

    return {
      totalMetrics: this.metrics.size,
      slowMetrics: slow,
      averageDuration: avgDuration,
    };
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * React hook for tracking component render performance
 * 
 * Measures the duration of each render cycle by recording time before and after
 * the component's DOM mutations are applied.
 * 
 * Usage:
 * ```tsx
 * function MyComponent() {
 *   useRenderPerformance('MyComponent');
 *   return <View>...</View>;
 * }
 * ```
 */
export function useRenderPerformance(componentName: string, metadata?: Record<string, any>) {
  const renderStartTime = React.useRef<number>(performance.now());
  const renderCount = React.useRef<number>(0);

  // Use useLayoutEffect to measure render time more accurately
  // This runs synchronously after all DOM mutations, capturing the actual render duration
  React.useLayoutEffect(() => {
    const renderEndTime = performance.now();
    const duration = renderEndTime - renderStartTime.current;
    renderCount.current += 1;

    if (__DEV__ && duration > SIXTY_FPS_THRESHOLD) { // Slower than 60fps
      console.error(
        `[Performance] ${componentName} render #${renderCount.current} took ${duration.toFixed(2)}ms (slower than 60fps)`,
        metadata
      );
    }
  });

  // Update start time for the next render at the beginning of the render phase
  renderStartTime.current = performance.now();
}

/**
 * Higher-order component for tracking screen load times
 * 
 * Usage:
 * ```tsx
 * export default withScreenPerformance(MyScreen, 'MyScreen');
 * ```
 */
export function withScreenPerformance<P extends object>(
  Component: React.ComponentType<P>,
  screenName: string
): React.ComponentType<P> {
  return function PerformanceTrackedComponent(props: P) {
    React.useEffect(() => {
      const metricName = `screen_load_${screenName}`;
      performanceMonitor.start(metricName, { screen: screenName });

      return () => {
        performanceMonitor.end(metricName);
      };
    }, []);

    return <Component {...props} />;
  };
}

/**
 * Decorator for tracking async function performance
 * 
 * Usage:
 * ```ts
 * const fetchData = trackAsyncPerformance('fetchData', async () => {
 *   const data = await api.getData();
 *   return data;
 * });
 * ```
 */
export function trackAsyncPerformance<T>(
  name: string,
  fn: (...args: any[]) => Promise<T>,
  metadata?: Record<string, any>
): (...args: any[]) => Promise<T> {
  return async function (...args: any[]): Promise<T> {
    performanceMonitor.start(name, metadata);
    try {
      const result = await fn(...args);
      performanceMonitor.end(name, { success: true });
      return result;
    } catch (error) {
      performanceMonitor.end(name, { success: false, error: String(error) });
      throw error;
    }
  };
}

/**
 * Utility for measuring memory usage (if available)
 * Note: performance.memory is a non-standard feature only available in Chrome-based browsers
 */
export function logMemoryUsage(label?: string) {
  if (!__DEV__) return;

  // Check if performance.memory is available (non-standard, Chrome only)
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    const memory = (performance as any).memory;
    if (memory && typeof memory.usedJSHeapSize === 'number') {
      const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = memory;
      console.log(
        `[Memory${label ? ` - ${label}` : ''}] Used: ${(usedJSHeapSize / 1048576).toFixed(2)}MB / Total: ${(totalJSHeapSize / 1048576).toFixed(2)}MB / Limit: ${(jsHeapSizeLimit / 1048576).toFixed(2)}MB`
      );
    }
  }
}
