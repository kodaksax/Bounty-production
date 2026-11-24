/**
 * Single-flight action locks (lib/interaction/single-flight.ts,
 * hooks/useSingleFlight.ts).
 *
 * Root cause under test: `setBusy(true)` + `disabled={busy}` does not stop a
 * double tap, because the second press is handled before React re-renders.
 * The lock must be taken synchronously, a second call must not start a second
 * run, and the lock must always be released so the user can retry.
 */
import React, { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { createKeyedSingleFlight, createSingleFlight } from '../../../lib/interaction/single-flight';
import { useSingleFlight, useSingleFlightCallback } from '../../../hooks/useSingleFlight';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSingleFlight', () => {
  it('runs once while in flight; later calls join the same promise', async () => {
    const flight = createSingleFlight();
    const d = deferred<string>();
    const fn = jest.fn(() => d.promise);

    const a = flight.run(fn);
    const b = flight.run(fn);
    const c = flight.run(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(flight.busy).toBe(true);

    d.resolve('done');
    await expect(Promise.all([a, b, c])).resolves.toEqual(['done', 'done', 'done']);
    expect(flight.busy).toBe(false);
  });

  it('releases after success so the next action runs', async () => {
    const flight = createSingleFlight();
    const fn = jest.fn(async () => 1);
    await flight.run(fn);
    await flight.run(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('releases after a rejection so the user can retry', async () => {
    const flight = createSingleFlight();
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('ok');
    await expect(flight.run(fn)).rejects.toThrow('network');
    expect(flight.busy).toBe(false);
    await expect(flight.run(fn)).resolves.toBe('ok');
  });

  it('a joined caller sees the same rejection', async () => {
    const flight = createSingleFlight();
    const d = deferred();
    const a = flight.run(() => d.promise);
    const b = flight.run(() => Promise.resolve());
    d.reject(new Error('boom'));
    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
  });

  it('a synchronous throw does not leave the lock held', async () => {
    const flight = createSingleFlight();
    await expect(
      flight.run(() => {
        throw new Error('sync');
      })
    ).rejects.toThrow('sync');
    expect(flight.busy).toBe(false);
    await expect(flight.run(() => 'again')).resolves.toBe('again');
  });
});

describe('createKeyedSingleFlight', () => {
  it('dedupes per key and runs different keys concurrently', async () => {
    const flights = createKeyedSingleFlight();
    const d1 = deferred();
    const d2 = deferred();
    const fn1 = jest.fn(() => d1.promise);
    const fn2 = jest.fn(() => d2.promise);

    flights.run('approve:1', fn1);
    flights.run('approve:1', fn1);
    flights.run('approve:2', fn2);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(flights.isBusy('approve:1')).toBe(true);

    d1.resolve();
    d2.resolve();
    await act(async () => {});
    expect(flights.isBusy('approve:1')).toBe(false);
    expect(flights.isBusy('approve:2')).toBe(false);
  });
});

describe('useSingleFlightCallback', () => {
  /** A button guarded the way the app's buttons were: state + disabled. */
  function SubmitButton({ action }: { action: () => Promise<void> }) {
    const [busy, setBusy] = useState(false);
    const onPress = useSingleFlightCallback(async () => {
      setBusy(true);
      try {
        await action();
      } finally {
        setBusy(false);
      }
    });
    return (
      <Pressable accessibilityLabel="Submit" disabled={busy} onPress={onPress}>
        <Text>{busy ? 'Working' : 'Submit'}</Text>
      </Pressable>
    );
  }

  it('a double tap before the re-render runs the action once', async () => {
    const d = deferred();
    const action = jest.fn(() => d.promise);
    const { getByLabelText } = render(<SubmitButton action={action} />);
    const button = getByLabelText('Submit');

    // Both presses land before React commits `disabled`.
    fireEvent.press(button);
    fireEvent.press(button);
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => d.resolve());
  });

  it('after the action finishes, the next tap runs normally', async () => {
    const action = jest.fn(() => Promise.resolve());
    const { getByLabelText } = render(<SubmitButton action={action} />);
    await act(async () => {
      fireEvent.press(getByLabelText('Submit'));
    });
    await act(async () => {
      fireEvent.press(getByLabelText('Submit'));
    });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('after the action fails, the user can retry', async () => {
    const action = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSingleFlightCallback(action));
    await act(async () => {
      await expect(result.current()).rejects.toThrow('offline');
    });
    await act(async () => {
      await result.current();
    });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('keeps a stable identity and calls the latest function across re-renders', async () => {
    const first = jest.fn(async () => 'first');
    const second = jest.fn(async () => 'second');
    const { result, rerender } = renderHook(({ fn }) => useSingleFlightCallback(fn), {
      initialProps: { fn: first },
    });
    const original = result.current;
    rerender({ fn: second });
    expect(result.current).toBe(original);
    await act(async () => {
      await expect(result.current()).resolves.toBe('second');
    });
    expect(first).not.toHaveBeenCalled();
  });

  it('a re-render during the action does not reset the lock', async () => {
    const d = deferred();
    const action = jest.fn(() => d.promise);
    const { result, rerender } = renderHook(() => useSingleFlightCallback(action));
    act(() => {
      void result.current();
    });
    rerender({});
    act(() => {
      void result.current();
    });
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve());
  });

  it('separate instances of the same component do not share a lock', () => {
    const d = deferred();
    const a = jest.fn(() => d.promise);
    const b = jest.fn(() => d.promise);
    const utils = render(
      <>
        <SubmitButton action={a} />
        <SubmitButton action={b} />
      </>
    );
    const [first, second] = utils.getAllByLabelText('Submit');
    fireEvent.press(first);
    fireEvent.press(second);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a screen that unmounts mid-action leaves no stale lock for its next mount', async () => {
    const d = deferred();
    const action = jest.fn(() => d.promise);
    const first = renderHook(() => useSingleFlightCallback(action));
    act(() => {
      void first.result.current();
    });
    first.unmount();

    const next = renderHook(() => useSingleFlightCallback(action));
    act(() => {
      void next.result.current();
    });
    expect(action).toHaveBeenCalledTimes(2);
    await act(async () => d.resolve());
  });
});

describe('useSingleFlight', () => {
  it('returns the same lock across renders, shared by every handler using it', () => {
    const { result, rerender } = renderHook(() => useSingleFlight());
    const lock = result.current;
    rerender({});
    expect(result.current).toBe(lock);
  });
});
