/**
 * lib/navigation/composer-request.ts: how a screen over the tab shell (Search)
 * asks it to open the composer. A request made while the shell isn't
 * listening (it's covered, or not mounted yet) waits for it, but not forever.
 */

import {
  COMPOSER_REQUEST_TTL_MS,
  requestComposer,
  subscribeComposerRequests,
} from 'lib/navigation/composer-request';

afterEach(() => {
  jest.useRealTimers();
});

it('delivers straight away to a listening shell', () => {
  const shell = jest.fn();
  const unsubscribe = subscribeComposerRequests(shell);
  requestComposer('search_fallback');
  unsubscribe();
  expect(shell).toHaveBeenCalledWith('search_fallback');
});

it('holds a request until the shell listens again, and delivers it once', () => {
  requestComposer('search_fallback');
  const shell = jest.fn();
  const unsubscribe = subscribeComposerRequests(shell);
  expect(shell).toHaveBeenCalledTimes(1);
  unsubscribe();

  // Not replayed on the next focus.
  const again = jest.fn();
  subscribeComposerRequests(again)();
  expect(again).not.toHaveBeenCalled();
});

it('drops a request nobody picked up in time', () => {
  jest.useFakeTimers();
  requestComposer('search_fallback');
  jest.advanceTimersByTime(COMPOSER_REQUEST_TTL_MS + 1);
  const shell = jest.fn();
  subscribeComposerRequests(shell)();
  expect(shell).not.toHaveBeenCalled();
});

it('stops delivering after unsubscribe', () => {
  const shell = jest.fn();
  subscribeComposerRequests(shell)();
  requestComposer('search_fallback');
  expect(shell).not.toHaveBeenCalled();
  // Clear the request this left pending.
  subscribeComposerRequests(jest.fn())();
});
