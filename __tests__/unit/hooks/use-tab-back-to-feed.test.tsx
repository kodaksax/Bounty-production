/**
 * useTabBackToFeed — Android hardware back in the tab shell.
 *
 * The shell's tabs are local state, so without this, back on a non-feed tab
 * closed the app. It must (1) return to the feed from other tabs, (2) leave
 * the feed and Post tabs alone, and (3) be inactive while the shell is not
 * focused, so it cannot swallow the back press of a screen pushed on top.
 */
import { renderHook } from '@testing-library/react-native';

type BackListener = () => boolean | null | undefined;

// The global react-native mock in jest.setup.js has no BackHandler (the same
// gap ProfileImageViewer.test.tsx extends locally). This one records the live
// listeners so the tests can press back and see what is still registered.
let mockListeners: BackListener[] = [];
const mockAddEventListener = jest.fn((_event: string, handler: BackListener) => {
  mockListeners.push(handler);
  return {
    remove: () => {
      mockListeners = mockListeners.filter(l => l !== handler);
    },
  };
});
jest.mock('react-native', () => ({
  // Deferred: the factory is hoisted above mockAddEventListener's declaration.
  BackHandler: { addEventListener: (...args: [string, BackListener]) => mockAddEventListener(...args) },
  Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
  View: 'View',
  Text: 'Text',
}));

// Models useFocusEffect's contract: the effect runs while the screen is
// focused and its cleanup runs on blur (or when the effect changes).
let mockFocused = true;
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      const focused = mockFocused;
      React.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
    },
  };
});

import { useTabBackToFeed } from '../../../hooks/useTabBackToFeed';

describe('useTabBackToFeed', () => {
  beforeEach(() => {
    mockFocused = true;
    mockListeners = [];
    mockAddEventListener.mockClear();
  });

  it.each(['wallet', 'profile', 'messages'])(
    'on the %s tab, back switches to the feed and consumes the press',
    tab => {
      const onBackToFeed = jest.fn();
      renderHook(() => useTabBackToFeed(tab, onBackToFeed));

      expect(mockListeners).toHaveLength(1);
      const consumed = mockListeners[0]();

      expect(onBackToFeed).toHaveBeenCalledTimes(1);
      expect(consumed).toBe(true);
    }
  );

  it.each(['bounty', 'postings'])('does not intercept back on the %s tab', tab => {
    const onBackToFeed = jest.fn();
    renderHook(() => useTabBackToFeed(tab, onBackToFeed));

    expect(mockAddEventListener).not.toHaveBeenCalled();
    expect(mockListeners).toHaveLength(0);
  });

  it('stops intercepting once the tab switches to the feed', () => {
    const onBackToFeed = jest.fn();
    const { rerender } = renderHook(({ tab }) => useTabBackToFeed(tab, onBackToFeed), {
      initialProps: { tab: 'wallet' },
    });
    expect(mockListeners).toHaveLength(1);

    rerender({ tab: 'bounty' });

    expect(mockListeners).toHaveLength(0);
  });

  it('registers nothing while the shell is not focused', () => {
    mockFocused = false;
    renderHook(() => useTabBackToFeed('wallet', jest.fn()));

    expect(mockAddEventListener).not.toHaveBeenCalled();
    expect(mockListeners).toHaveLength(0);
  });

  it('removes its listener when a screen is pushed on top (blur)', () => {
    const onBackToFeed = jest.fn();
    const { rerender } = renderHook(() => useTabBackToFeed('wallet', onBackToFeed));
    expect(mockListeners).toHaveLength(1);

    mockFocused = false; // e.g. a bounty detail pushed from the Wallet tab
    rerender({});

    expect(mockListeners).toHaveLength(0);
    expect(onBackToFeed).not.toHaveBeenCalled();
  });
});
