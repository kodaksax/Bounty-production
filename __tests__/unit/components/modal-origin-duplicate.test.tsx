/**
 * Bounty cards open their detail dialog through useModalOrigin().openFrom.
 * Each card owns its own dialog, so tapping card A and then card B before the
 * first dialog appeared used to stack two dialogs. openFrom is now a
 * navigation tap (lib/navigation/navigation-guard.ts): the first card opens,
 * a second card tapped while it opens does not, and the next tap after the
 * transition works normally.
 */
import { act, renderHook } from '@testing-library/react-native';
import { useModalOrigin } from '../../../components/ui/app-modal';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function card() {
  return renderHook(() => useModalOrigin()).result;
}

test('a double tap on one card opens its dialog once', () => {
  const a = card();
  const open = jest.fn();
  act(() => {
    a.current.openFrom(open);
    a.current.openFrom(open);
    jest.advanceTimersByTime(60);
  });
  expect(open).toHaveBeenCalledTimes(1);
});

test('a second card tapped while the first opens does not open a second dialog', () => {
  const a = card();
  const b = card();
  const openA = jest.fn();
  const openB = jest.fn();
  act(() => {
    a.current.openFrom(openA);
    b.current.openFrom(openB);
    jest.advanceTimersByTime(60);
  });
  expect(openA).toHaveBeenCalledTimes(1);
  expect(openB).not.toHaveBeenCalled();
});

test('the next card opens normally once the first has settled', () => {
  const a = card();
  const b = card();
  const openA = jest.fn();
  const openB = jest.fn();
  act(() => {
    a.current.openFrom(openA);
    jest.advanceTimersByTime(16);
    jest.advanceTimersByTime(600);
  });
  act(() => {
    b.current.openFrom(openB);
    jest.advanceTimersByTime(60);
  });
  expect(openA).toHaveBeenCalledTimes(1);
  expect(openB).toHaveBeenCalledTimes(1);
});
