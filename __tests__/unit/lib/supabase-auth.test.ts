/**
 * Unit tests for lib/utils/supabase-auth.ts → waitForAuthEvent
 *
 * These tests verify that the helper:
 *  - resolves as soon as an auth state change provides a session
 *  - times out and resolves null when no session arrives
 *  - ignores events that carry a null session
 *  - unsubscribes the listener in all code paths
 *  - handles synchronous callbacks (subscription returned after callback fires)
 */

jest.useFakeTimers();

describe('waitForAuthEvent (lib/utils/supabase-auth)', () => {
  let onAuthStateChangeMock: jest.Mock;
  let unsubscribeMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();

    unsubscribeMock = jest.fn();
    onAuthStateChangeMock = jest.fn();

    jest.doMock('../../../lib/supabase', () => ({
      supabase: {
        auth: {
          onAuthStateChange: onAuthStateChangeMock,
        },
      },
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the session and unsubscribes when a session event fires', async () => {
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      // Fire asynchronously to simulate typical Supabase SDK behaviour
      setTimeout(() => cb('SIGNED_IN', { user: { id: 'user-abc' } }), 0);
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });

    const { waitForAuthEvent } = require('../../../lib/utils/supabase-auth');

    const promise = waitForAuthEvent(5000);
    jest.runOnlyPendingTimers();
    const session = await promise;

    expect(session).not.toBeNull();
    expect((session as any).user.id).toBe('user-abc');
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('resolves null and unsubscribes when the timeout elapses', async () => {
    onAuthStateChangeMock.mockImplementation((_cb: any) => {
      // Never fire
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });

    const { waitForAuthEvent } = require('../../../lib/utils/supabase-auth');

    const promise = waitForAuthEvent(5000);
    jest.advanceTimersByTime(5000);
    await Promise.resolve(); // flush microtasks
    const session = await promise;

    expect(session).toBeNull();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('ignores events where session is null, resolves on subsequent session', async () => {
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      setTimeout(() => cb('TOKEN_REFRESHED', null), 10);
      setTimeout(() => cb('SIGNED_IN', { user: { id: 'final-user' } }), 20);
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });

    const { waitForAuthEvent } = require('../../../lib/utils/supabase-auth');

    const promise = waitForAuthEvent(5000);
    jest.advanceTimersByTime(20);
    const session = await promise;

    expect(session).not.toBeNull();
    expect((session as any).user.id).toBe('final-user');
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('handles synchronous callbacks where subscription is assigned after callback fires', async () => {
    onAuthStateChangeMock.mockImplementation((cb: any) => {
      // Callback fires synchronously — before subscription is captured
      cb('SIGNED_IN', { user: { id: 'sync-user' } });
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });

    const { waitForAuthEvent } = require('../../../lib/utils/supabase-auth');

    const session = await waitForAuthEvent(5000);

    expect(session).not.toBeNull();
    expect((session as any).user.id).toBe('sync-user');
    // Subscription returned after sync callback; unsubscribe should still be called
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('does not resolve more than once even if the callback fires multiple times', async () => {
    const resolveSpy = jest.fn();

    onAuthStateChangeMock.mockImplementation((cb: any) => {
      setTimeout(() => cb('SIGNED_IN', { user: { id: 'first' } }), 10);
      setTimeout(() => cb('SIGNED_IN', { user: { id: 'second' } }), 20);
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });

    const { waitForAuthEvent } = require('../../../lib/utils/supabase-auth');

    const promise = waitForAuthEvent(5000);
    jest.advanceTimersByTime(30);
    const session = await promise;

    // Only the first event should be returned
    expect((session as any).user.id).toBe('first');
    // Unsubscribe called exactly once
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('handles malformed subscription shape without throwing', async () => {
    onAuthStateChangeMock.mockImplementation((_cb: any) => {
      // Return an unexpected shape — should not throw
      return undefined;
    });

    const { waitForAuthEvent } = require('../../../lib/utils/supabase-auth');

    const promise = waitForAuthEvent(100);
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    const session = await promise;

    // Should resolve null without throwing
    expect(session).toBeNull();
  });
});
