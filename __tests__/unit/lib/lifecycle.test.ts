import {
    createDeferredCleanupController,
    resolveMaybeAsyncRegistration,
    safeCleanup,
} from '../../../lib/utils/lifecycle';

describe('lifecycle utilities', () => {
  test('safeCleanup executes function handles', () => {
    const teardown = jest.fn();
    safeCleanup(teardown);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  test('safeCleanup executes object handles with remove', () => {
    const remove = jest.fn();
    safeCleanup({ remove });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('safeCleanup reports teardown errors via callback', () => {
    const onError = jest.fn();
    safeCleanup(
      {
        unsubscribe: () => {
          throw new Error('boom');
        },
      },
      onError
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('resolveMaybeAsyncRegistration resolves sync registrations', () => {
    const onResolved = jest.fn();
    resolveMaybeAsyncRegistration({ value: 42 }, onResolved);
    expect(onResolved).toHaveBeenCalledWith({ value: 42 });
  });

  test('resolveMaybeAsyncRegistration resolves promise registrations', async () => {
    const onResolved = jest.fn();
    resolveMaybeAsyncRegistration(Promise.resolve({ value: 42 }), onResolved);
    await Promise.resolve();
    expect(onResolved).toHaveBeenCalledWith({ value: 42 });
  });

  test('createDeferredCleanupController cleans up late-resolving handles', () => {
    const remove = jest.fn();
    const controller = createDeferredCleanupController();

    // Cleanup is requested before the registration resolves.
    controller.cleanup();
    controller.setHandle({ remove });

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
