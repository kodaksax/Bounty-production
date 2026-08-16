/**
 * Unit tests for createForegroundTimer (lib/utils/foreground-timer.ts).
 *
 * Uses Jest's modern fake timers, which also fake the global `performance`
 * clock (verified: jest.advanceTimersByTime advances performance.now()), so
 * these tests run instantly while still exercising real elapsed-time math.
 */

import { createForegroundTimer } from '../../../../lib/utils/foreground-timer';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createForegroundTimer', () => {
  it('reports zero elapsed seconds before start() is called', () => {
    const timer = createForegroundTimer();
    jest.advanceTimersByTime(5000);
    expect(timer.elapsedSeconds()).toBe(0);
  });

  it('accumulates elapsed time after start()', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(7000);
    expect(timer.elapsedSeconds()).toBe(7);
  });

  it('excludes time between pause() and resume()', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(3000);
    timer.pause();
    jest.advanceTimersByTime(60000); // backgrounded for a full minute
    timer.resume();
    jest.advanceTimersByTime(2000);
    expect(timer.elapsedSeconds()).toBe(5); // 3s + 2s, not 65s
  });

  it('continues accumulating from where it paused, not from zero', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(10000);
    timer.pause();
    jest.advanceTimersByTime(30000);
    timer.resume();
    expect(timer.elapsedSeconds()).toBe(10); // still 10s immediately after resume
    jest.advanceTimersByTime(4000);
    expect(timer.elapsedSeconds()).toBe(14);
  });

  it('accumulates correctly across multiple pause/resume cycles', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(2000);
    timer.pause();
    jest.advanceTimersByTime(10000);
    timer.resume();
    jest.advanceTimersByTime(3000);
    timer.pause();
    jest.advanceTimersByTime(20000);
    timer.resume();
    jest.advanceTimersByTime(1000);
    expect(timer.elapsedSeconds()).toBe(6); // 2 + 3 + 1
  });

  it('pause() is a no-op when already paused', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(2000);
    timer.pause();
    timer.pause(); // double-pause should not double-count anything
    jest.advanceTimersByTime(5000);
    timer.resume();
    expect(timer.elapsedSeconds()).toBe(2);
  });

  it('resume() is a no-op when already running', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(1000);
    timer.resume(); // already running — must not reset the running-since point
    jest.advanceTimersByTime(1000);
    expect(timer.elapsedSeconds()).toBe(2);
  });

  it('reset() zeroes accumulation and keeps running if it was running', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(15000);
    timer.reset();
    expect(timer.elapsedSeconds()).toBe(0);
    jest.advanceTimersByTime(3000);
    expect(timer.elapsedSeconds()).toBe(3);
  });

  it('reset() on a never-started timer leaves it not running', () => {
    const timer = createForegroundTimer();
    timer.reset();
    jest.advanceTimersByTime(5000);
    expect(timer.elapsedSeconds()).toBe(0);
  });

  it('reset() while paused stays paused (no phantom accumulation)', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(4000);
    timer.pause();
    timer.reset();
    jest.advanceTimersByTime(9000);
    expect(timer.elapsedSeconds()).toBe(0);
    timer.resume();
    jest.advanceTimersByTime(2000);
    expect(timer.elapsedSeconds()).toBe(2);
  });

  it('start() re-arms a timer that was already running elsewhere in its life', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(100000);
    timer.start(); // e.g. re-entering the flow after a fresh mount
    expect(timer.elapsedSeconds()).toBe(0);
    jest.advanceTimersByTime(4000);
    expect(timer.elapsedSeconds()).toBe(4);
  });

  it('rounds to the nearest whole second at read time', () => {
    const timer = createForegroundTimer();
    timer.start();
    jest.advanceTimersByTime(1499);
    expect(timer.elapsedSeconds()).toBe(1);
    jest.advanceTimersByTime(1); // now at 1500ms exactly
    expect(timer.elapsedSeconds()).toBe(2);
  });
});
