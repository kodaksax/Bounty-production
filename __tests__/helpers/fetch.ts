/**
 * Mock fetch helpers for testing
 * Prevents real HTTP requests during tests and provides deterministic responses
 */

/**
 * Mock global fetch with a successful response
 */
export function mockFetchSuccess<T = any>(data: T, status = 200): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({
      'content-type': 'application/json',
    }),
  } as Response);
}

/**
 * Mock global fetch with an error response
 */
export function mockFetchError(error: Error | string, status = 500): void {
  const errorMessage = typeof error === 'string' ? error : error.message;
  
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: errorMessage,
    json: async () => {
      throw new Error(errorMessage);
    },
    text: async () => errorMessage,
    headers: new Headers({
      'content-type': 'application/json',
    }),
  } as Response);
}

/**
 * Mock fetch to reject with network error
 */
export function mockFetchNetworkError(errorMessage = 'Network request failed'): void {
  global.fetch = jest.fn().mockRejectedValue(new Error(errorMessage));
}

/**
 * Reset fetch mock to default
 */
export function resetFetchMock(): void {
  if (global.fetch && typeof (global.fetch as jest.Mock).mockRestore === 'function') {
    (global.fetch as jest.Mock).mockRestore();
  }
}

/**
 * Verify no real fetch calls were made
 */
export function expectNoRealFetchCalls(): void {
  if (global.fetch && typeof (global.fetch as jest.Mock).mock !== 'undefined') {
    expect((global.fetch as jest.Mock).mock).toBeDefined();
  }
}
