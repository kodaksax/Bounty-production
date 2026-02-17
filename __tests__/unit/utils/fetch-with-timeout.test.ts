/**
 * Unit tests for fetchWithTimeout utility
 */

import { fetchWithTimeout } from '../../../lib/utils/fetch-with-timeout';

// Mock global fetch
global.fetch = jest.fn();

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AbortError handling', () => {
    it('should convert internal timeout to TimeoutError with user-friendly message', async () => {
      (global.fetch as jest.Mock).mockImplementation(() => 
        new Promise((resolve, reject) => {
          // Simulate AbortError from timeout
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 100);
        })
      );

      await expect(fetchWithTimeout('https://api.example.com/test', {
        timeout: 50,
        retries: 0,
      })).rejects.toMatchObject({
        name: 'TimeoutError',
        message: expect.stringContaining('Connection timed out after'),
      });
    });

    it('should handle external AbortSignal cancellation with correct message', async () => {
      const controller = new AbortController();
      
      (global.fetch as jest.Mock).mockImplementation(() => 
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 1000);
        })
      );

      const promise = fetchWithTimeout('https://api.example.com/test', {
        timeout: 10000,
        retries: 0,
        signal: controller.signal,
      });

      // Cancel externally before fetch completes
      setTimeout(() => controller.abort(), 10);

      await expect(promise).rejects.toMatchObject({
        name: 'AbortError',
        message: 'Connection interrupted. Please try again.',
      });
    });

    it('should handle pre-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();

      (global.fetch as jest.Mock).mockImplementation(() => 
        Promise.resolve({ ok: true, json: async () => ({}) })
      );

      await expect(fetchWithTimeout('https://api.example.com/test', {
        timeout: 10000,
        retries: 0,
        signal: controller.signal,
      })).rejects.toMatchObject({
        name: 'AbortError',
        message: 'Connection interrupted. Please try again.',
      });
    });
  });

  describe('retry logic', () => {
    it('should retry on 5xx errors', async () => {
      let callCount = 0;
      (global.fetch as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const result = await fetchWithTimeout('https://api.example.com/test', {
        timeout: 10000,
        retries: 1,
        retryDelay: 10,
      });

      expect(result.ok).toBe(true);
      expect(callCount).toBe(2);
    });

    it('should retry on network errors', async () => {
      let callCount = 0;
      (global.fetch as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          const error = new Error('Network request failed');
          error.name = 'NetworkError';
          return Promise.reject(error);
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const result = await fetchWithTimeout('https://api.example.com/test', {
        timeout: 10000,
        retries: 1,
        retryDelay: 10,
      });

      expect(result.ok).toBe(true);
      expect(callCount).toBe(2);
    });

    it('should not retry on 4xx errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await fetchWithTimeout('https://api.example.com/test', {
        timeout: 10000,
        retries: 2,
      });

      expect(result.status).toBe(404);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry when externally cancelled', async () => {
      const controller = new AbortController();
      let callCount = 0;

      (global.fetch as jest.Mock).mockImplementation(() => {
        callCount++;
        return new Promise((resolve) => {
          setTimeout(() => resolve({ ok: false, status: 500 }), 100);
        });
      });

      const promise = fetchWithTimeout('https://api.example.com/test', {
        timeout: 10000,
        retries: 3,
        signal: controller.signal,
      });

      // Cancel immediately
      setTimeout(() => controller.abort(), 10);

      await expect(promise).rejects.toMatchObject({
        name: 'AbortError',
      });

      // Should not retry after external cancellation
      expect(callCount).toBe(1);
    });
  });

  describe('success scenarios', () => {
    it('should return successful response immediately', async () => {
      const mockResponse = { ok: true, status: 200, json: async () => ({ data: 'test' }) };
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

      const result = await fetchWithTimeout('https://api.example.com/test', {
        timeout: 10000,
        retries: 2,
      });

      expect(result).toBe(mockResponse);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should pass through fetch options', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await fetchWithTimeout('https://api.example.com/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' }),
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: 'data' }),
        })
      );
    });
  });
});

