/**
 * Duplicate-navigation guard (lib/navigation/navigation-guard.ts).
 *
 * Root cause under test: expo-router's push only enqueues, so two taps that
 * land before the first push renders both navigate. The guard drops a call
 * identical to the one still settling (router layer) and, for list rows, any
 * second navigation tap (press layer). Programmatic sequences of DIFFERENT
 * calls must never be dropped.
 *
 * A fake clock and a manual frame queue stand in for Date.now and
 * requestAnimationFrame, so "the JS thread was blocked for 2s before the next
 * frame" can be expressed exactly.
 */
import {
  NAVIGATION_MAX_PENDING_MS,
  NAVIGATION_SETTLE_MS,
  createNavigationGuard,
  hrefKey,
} from '../../../lib/navigation/navigation-guard';

function setup() {
  let t = 1_000;
  const frames: Array<() => void> = [];
  const dropped: string[] = [];
  const guard = createNavigationGuard({
    now: () => t,
    scheduleFrame: (cb) => frames.push(cb),
    onDrop: (key) => dropped.push(key),
  });
  const calls: Array<[string, ...unknown[]]> = [];
  const router = guard.wrapRouter({
    push: (...a: unknown[]) => calls.push(['push', ...a]),
    navigate: (...a: unknown[]) => calls.push(['navigate', ...a]),
    replace: (...a: unknown[]) => calls.push(['replace', ...a]),
    dismissTo: (...a: unknown[]) => calls.push(['dismissTo', ...a]),
    back: () => calls.push(['back']),
    dismiss: (n?: number) => calls.push(['dismiss', n]),
    dismissAll: () => calls.push(['dismissAll']),
    canGoBack: () => true,
    setParams: (p: unknown) => calls.push(['setParams', p]),
  });
  return {
    guard,
    router,
    calls,
    dropped,
    /** Advance the clock without rendering a frame (a blocked JS thread). */
    wait: (ms: number) => {
      t += ms;
    },
    /** Render the next frame. */
    frame: () => {
      t += 16;
      frames.splice(0).forEach((cb) => cb());
    },
    /** A frame, then the full settle window. */
    settle: () => {
      t += 16;
      frames.splice(0).forEach((cb) => cb());
      t += NAVIGATION_SETTLE_MS;
    },
  };
}

describe('router layer: identical calls', () => {
  it('drops a double and a triple push to the same screen', () => {
    const { router, calls } = setup();
    router.push('/tabs/messenger/user/alice');
    router.push('/tabs/messenger/user/alice');
    router.push('/tabs/messenger/user/alice');
    expect(calls).toEqual([['push', '/tabs/messenger/user/alice']]);
  });

  it('treats object hrefs with the same params as the same destination', () => {
    const { router, calls } = setup();
    router.push({ pathname: '/postings/[bountyId]', params: { bountyId: '7', person: '3' } });
    router.push({ pathname: '/postings/[bountyId]', params: { person: '3', bountyId: '7' } });
    expect(calls).toHaveLength(1);
  });

  it('allows the same push again once the transition has settled', () => {
    const { router, calls, settle } = setup();
    router.push('/bounty/1');
    settle();
    router.push('/bounty/1');
    expect(calls).toHaveLength(2);
  });

  it('holds the window open while the first frame has not rendered (slow JS)', () => {
    const { router, calls, wait, frame } = setup();
    router.push('/bounty/1');
    // The destination is heavy: the JS thread is busy for 2s, and the second
    // tap is handled only after that, long past any wall-clock window.
    wait(2_000);
    router.push('/bounty/1');
    expect(calls).toHaveLength(1);
    // Still a duplicate just after the frame finally renders.
    frame();
    router.push('/bounty/1');
    expect(calls).toHaveLength(1);
  });

  it('never locks navigation indefinitely if a frame never comes', () => {
    const { router, calls, wait } = setup();
    router.push('/bounty/1');
    wait(NAVIGATION_MAX_PENDING_MS + 1);
    router.push('/bounty/1');
    expect(calls).toHaveLength(2);
  });

  it('drops a double back tap', () => {
    const { router, calls } = setup();
    router.back();
    router.back();
    expect(calls).toEqual([['back']]);
  });

  it('allows two separate back navigations once the first settles', () => {
    const { router, calls, settle } = setup();
    router.back();
    settle();
    router.back();
    expect(calls).toEqual([['back'], ['back']]);
  });

  it('drops duplicate replace, navigate, dismiss and dismissAll calls', () => {
    const { router, calls, settle } = setup();
    router.replace('/tabs/bounty-app');
    router.replace('/tabs/bounty-app');
    settle();
    router.navigate('/wallet');
    router.navigate('/wallet');
    settle();
    router.dismiss();
    router.dismiss(1);
    settle();
    router.dismissAll();
    router.dismissAll();
    expect(calls).toEqual([
      ['replace', '/tabs/bounty-app'],
      ['navigate', '/wallet'],
      ['dismiss', undefined],
      ['dismissAll'],
    ]);
  });

  it('passes extra arguments through to the router', () => {
    const { router, calls } = setup();
    router.push('/bounty/1', { withAnchor: true });
    expect(calls).toEqual([['push', '/bounty/1', { withAnchor: true }]]);
  });

  it('does not guard methods that do not navigate', () => {
    const { router, calls } = setup();
    router.setParams({ a: 1 });
    router.setParams({ a: 1 });
    expect(calls).toHaveLength(2);
    expect(router.canGoBack()).toBe(true);
  });
});

describe('router layer: programmatic sequences are untouched', () => {
  it('lets back() then push() run in one handler', () => {
    const { router, calls } = setup();
    router.back();
    router.push('/bounty/1');
    expect(calls).toEqual([['back'], ['push', '/bounty/1']]);
  });

  it('lets replace() then push() run (notification deep link)', () => {
    const { router, calls } = setup();
    router.replace('/tabs/bounty-app');
    router.push('/bounty/1');
    expect(calls).toHaveLength(2);
  });

  it('lets the mounted screen redirect immediately after a push', () => {
    const { router, calls } = setup();
    router.push('/bounty/1');
    router.replace('/auth/sign-in-form');
    expect(calls).toHaveLength(2);
  });

  it('lets push A, back, push A run (opened, left, reopened)', () => {
    const { router, calls } = setup();
    router.push('/bounty/1');
    router.back();
    router.push('/bounty/1');
    expect(calls).toHaveLength(3);
  });

  it('pushes to two different screens are both allowed at the router layer', () => {
    const { router, calls } = setup();
    router.push('/bounty/1');
    router.push('/bounty/2');
    expect(calls).toHaveLength(2);
  });
});

describe('press layer: one navigation tap at a time', () => {
  it('runs the first tap and drops a second tap on another row', () => {
    const { guard, router, calls } = setup();
    expect(guard.runPress(() => router.push('/tabs/messenger/user/alice'))).toBe(true);
    expect(guard.runPress(() => router.push('/tabs/messenger/user/bob'))).toBe(false);
    expect(calls).toEqual([['push', '/tabs/messenger/user/alice']]);
  });

  it('admits the next tap once the transition settles', () => {
    const { guard, router, calls, settle } = setup();
    guard.runPress(() => router.push('/a'));
    settle();
    guard.runPress(() => router.push('/b'));
    expect(calls).toHaveLength(2);
  });

  it('a back navigation reopens the press layer immediately', () => {
    const { guard, router, calls } = setup();
    guard.runPress(() => router.push('/a'));
    router.back();
    expect(guard.runPress(() => router.push('/b'))).toBe(true);
    expect(calls).toEqual([['push', '/a'], ['back'], ['push', '/b']]);
  });

  it('is independent of the router layer (a redirect is never blocked by a tap)', () => {
    const { guard, router, calls } = setup();
    guard.runPress(() => router.push('/bounty/1'));
    router.replace('/auth/sign-in-form');
    expect(calls).toHaveLength(2);
  });

  it('reset() clears both layers', () => {
    const { guard, router, calls } = setup();
    guard.runPress(() => router.push('/a'));
    guard.reset();
    guard.runPress(() => router.push('/a'));
    expect(calls).toHaveLength(2);
  });
});

describe('isBackSettling', () => {
  it('is true only while a back is settling', () => {
    const { guard, router, settle } = setup();
    expect(guard.isBackSettling()).toBe(false);
    router.back();
    expect(guard.isBackSettling()).toBe(true);
    settle();
    expect(guard.isBackSettling()).toBe(false);
    router.back();
    router.push('/a');
    expect(guard.isBackSettling()).toBe(false);
  });
});

describe('wrapRouter', () => {
  it('is idempotent: wrapping twice does not double-guard', () => {
    const { guard, router, calls, settle } = setup();
    guard.wrapRouter(router);
    router.push('/a');
    settle();
    router.push('/a');
    expect(calls).toHaveLength(2);
  });

  it('tolerates a missing router (a jest mock without `router`)', () => {
    const guard = createNavigationGuard();
    expect(guard.wrapRouter(undefined as unknown as object)).toBeUndefined();
  });

  it('guards the shared object, so every holder of it is guarded', () => {
    const guard = createNavigationGuard({ scheduleFrame: () => {} });
    const push = jest.fn();
    const shared = { push };
    guard.wrapRouter(shared);
    // What useRouter() returns in screen A and screen B is the same object.
    const fromScreenA = shared;
    const fromScreenB = shared;
    fromScreenA.push('/x');
    fromScreenB.push('/x');
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('hrefKey', () => {
  it('normalises strings and objects', () => {
    expect(hrefKey('/a?b=1')).toBe('/a?b=1');
    expect(hrefKey({ pathname: '/p/[id]', params: { id: '1', x: 'y' } })).toBe(
      hrefKey({ pathname: '/p/[id]', params: { x: 'y', id: '1' } })
    );
    expect(hrefKey({ pathname: '/p/[id]', params: { id: '1' } })).not.toBe(
      hrefKey({ pathname: '/p/[id]', params: { id: '2' } })
    );
    expect(hrefKey({ pathname: '/p' })).toBe('/p?');
  });
});
