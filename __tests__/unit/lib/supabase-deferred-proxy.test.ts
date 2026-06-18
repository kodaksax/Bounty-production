/**
 * Regression test for the Supabase deferred-proxy "Object is not a function" crash.
 *
 * Background: `makeDeferredProxy` wraps the Supabase client so callers can use
 * the fluent API before the real client has finished initializing. It exposes
 * an `apply` trap to queue pre-resolution calls and return a Promise. A Proxy
 * only has a callable `[[Call]]` internal method when its *target* is callable;
 * the original implementation used a plain-object target (`{}`), which made the
 * `apply` trap dead code. As a result, invoking any chained method before the
 * client resolved (e.g. `supabase.auth.onAuthStateChange(...)`) threw
 * "TypeError: Object is not a function" and crashed the whole app via the root
 * error boundary.
 *
 * These tests pin the fixed behavior: pre-resolution calls must NOT throw and
 * must resolve correctly once the real target becomes available.
 */
import { makeDeferredProxy } from '../../../lib/supabase';

describe('makeDeferredProxy pre-resolution call safety', () => {
  it('does not throw when a nested method is called before the target resolves', async () => {
    let resolveTarget: (t: unknown) => void = () => {};
    const targetPromise = new Promise<unknown>((res) => {
      resolveTarget = res;
    });

    const proxy = makeDeferredProxy(() => targetPromise as Promise<object>, 'test') as any;

    // Invoking a nested method before resolution must not throw synchronously.
    let result: any;
    expect(() => {
      result = proxy.auth.onAuthStateChange(() => {});
    }).not.toThrow();

    // The pre-resolution call returns a thenable that settles after resolution.
    expect(typeof result.then).toBe('function');

    const onAuthStateChange = jest.fn(() => ({
      data: { subscription: { unsubscribe: () => {} } },
    }));
    resolveTarget({ auth: { onAuthStateChange } });

    const settled = await result;
    expect(onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(settled).toEqual({ data: { subscription: expect.anything() } });
  });

  it('invokes methods synchronously once the target has resolved', async () => {
    const from = jest.fn(() => 'table-builder');
    const proxy = makeDeferredProxy(async () => ({ from }), 'test') as any;

    // Await the proxy directly — its `then` trap delegates to getRealTarget(),
    // so this deterministically waits for the real target to be resolved.
    await proxy;

    const builder = proxy.from('notifications');
    expect(from).toHaveBeenCalledWith('notifications');
    expect(builder).toBe('table-builder');
  });
});
