/**
 * Unit tests for withTimeout utility
 */

import { withTimeout } from '../../../lib/utils/withTimeout';

describe('withTimeout', () => {
  it('should resolve when promise completes before timeout', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, 1000);
    expect(result).toBe('success');
  });

  it('should reject with timeout error when promise takes too long', async () => {
    const slowPromise = new Promise((resolve) => {
      setTimeout(() => resolve('too slow'), 2000);
    });

    await expect(withTimeout(slowPromise, 100))
      .rejects
      .toThrow(/timed out|timeout/i);
  }, 5000); // Allow time for the test to complete

  it('should propagate promise rejection', async () => {
    const failingPromise = Promise.reject(new Error('original error'));
    
    await expect(withTimeout(failingPromise, 1000))
      .rejects
      .toThrow('original error');
  });

  it('should handle different timeout values', async () => {
    const promise = new Promise((resolve) => setTimeout(() => resolve('done'), 50));
    
    // Should succeed with 100ms timeout
    const result = await withTimeout(promise, 100);
    expect(result).toBe('done');
  }, 5000);

  it('should timeout correctly with 0ms timeout', async () => {
    const promise = new Promise((resolve) => setTimeout(() => resolve('done'), 100));
    
    await expect(withTimeout(promise, 0))
      .rejects
      .toThrow(/timed out|timeout/i);
  }, 5000);

  it('should work with async functions', async () => {
    const asyncFunc = async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'async result';
    };

    const result = await withTimeout(asyncFunc(), 1000);
    expect(result).toBe('async result');
  }, 5000);

  it('should work with fetch-like promises', async () => {
    const mockFetch = () => Promise.resolve({
      ok: true,
      json: async () => ({ data: 'test' })
    });

    const result = await withTimeout(mockFetch(), 1000);
    expect(result.ok).toBe(true);
    const data = await result.json();
    expect(data.data).toBe('test');
  });
});
