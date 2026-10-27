/**
 * lib/navigation/tab-shell-return — flows go back to the mounted tab shell
 * instead of stacking a fresh one (which reset the feed's scroll, filters and
 * the Inbox segment, and left a stale shell underneath).
 */
import { NavigationContext } from '@react-navigation/native';
import { render } from '@testing-library/react-native';
import React from 'react';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

import {
  onTabShellRequest,
  planReturnToTabShell,
  tabShellTargetForRoute,
  useReturnToTabShell,
  type TabShellTarget,
} from '../../../lib/navigation/tab-shell-return';

// Navigation state shaped like expo-router's: the root stack holds `tabs`
// (whose own stack holds the shell, `bounty-app`) plus whatever was opened
// over it.
const shellStack = (...extra: string[]) => ({
  key: 'tabs-stack',
  index: extra.length,
  routes: [{ key: 'shell', name: 'bounty-app' }, ...extra.map(name => ({ key: name, name }))],
});

describe('planReturnToTabShell', () => {
  it('needs no pops when the shell is already on top', () => {
    const state = { key: 'root', index: 0, routes: [{ key: 'tabs', name: 'tabs', state: shellStack() }] };
    expect(planReturnToTabShell(state)).toEqual([]);
  });

  it('pops the screens opened over the shell (payout over the shell)', () => {
    const state = {
      key: 'root',
      index: 1,
      routes: [
        { key: 'tabs', name: 'tabs', state: shellStack() },
        { key: 'payout', name: 'postings/[bountyId]' },
      ],
    };
    expect(planReturnToTabShell(state)).toEqual([{ type: 'POP', payload: { count: 1 }, target: 'root' }]);
  });

  it("also pops what was pushed inside the shell's own stack, innermost first", () => {
    // Inbox → bounty thread (pushed in the tabs stack) → payout (root).
    // A dismissTo('/tabs/bounty-app') here pushed a second shell over the
    // thread instead of popping to the first.
    const state = {
      key: 'root',
      index: 1,
      routes: [
        { key: 'tabs', name: 'tabs', state: shellStack('bounty-thread/[bountyId]') },
        { key: 'payout', name: 'postings/[bountyId]' },
      ],
    };
    expect(planReturnToTabShell(state)).toEqual([
      { type: 'POP', payload: { count: 1 }, target: 'tabs-stack' },
      { type: 'POP', payload: { count: 1 }, target: 'root' },
    ]);
  });

  it('closes search on the way back (search → result → "Browse other bounties")', () => {
    // Search is pushed inside the tabs stack, so it is popped with the
    // result: the user lands on the feed, which kept its own filters.
    const state = {
      key: 'root',
      index: 1,
      routes: [
        { key: 'tabs', name: 'tabs', state: shellStack('search') },
        { key: 'public', name: 'bounty/[id]' },
      ],
    };
    expect(planReturnToTabShell(state)).toEqual([
      { type: 'POP', payload: { count: 1 }, target: 'tabs-stack' },
      { type: 'POP', payload: { count: 1 }, target: 'root' },
    ]);
  });

  it('skips a later `tabs` instance that holds no shell', () => {
    // `tabs` is pushed again to open a chat from a hunter hub.
    const state = {
      key: 'root',
      index: 2,
      routes: [
        { key: 'tabs', name: 'tabs', state: shellStack() },
        { key: 'hub', name: 'in-progress/[bountyId]/hunter' },
        {
          key: 'tabs-2',
          name: 'tabs',
          state: { key: 'tabs-stack-2', index: 0, routes: [{ key: 'chat', name: 'messenger/[conversationId]' }] },
        },
      ],
    };
    expect(planReturnToTabShell(state)).toEqual([{ type: 'POP', payload: { count: 2 }, target: 'root' }]);
  });

  it('returns to the nearest shell when a duplicate already exists', () => {
    const state = {
      key: 'root',
      index: 2,
      routes: [
        { key: 'tabs', name: 'tabs', state: shellStack() },
        { key: 'detail', name: 'bounty/[id]' },
        { key: 'tabs-2', name: 'tabs', state: { ...shellStack('search'), key: 'tabs-stack-2' } },
      ],
    };
    expect(planReturnToTabShell(state)).toEqual([
      { type: 'POP', payload: { count: 1 }, target: 'tabs-stack-2' },
    ]);
  });

  it('returns null when no shell is mounted (a cold link straight into a flow)', () => {
    const state = { key: 'root', index: 0, routes: [{ key: 'payout', name: 'postings/[bountyId]' }] };
    expect(planReturnToTabShell(state)).toBeNull();
    expect(planReturnToTabShell(undefined)).toBeNull();
  });

  it('returns null rather than guess when a stack it must pop has no key', () => {
    const state = {
      index: 1,
      routes: [
        { key: 'tabs', name: 'tabs', state: shellStack() },
        { key: 'payout', name: 'postings/[bountyId]' },
      ],
    };
    expect(planReturnToTabShell(state)).toBeNull();
  });
});

describe('tabShellTargetForRoute', () => {
  it.each([
    ['/tabs/bounty-app', { tab: 'bounty', initialTab: undefined }],
    ['/tabs/bounty-app?tab=wallet', { tab: 'wallet', initialTab: undefined }],
    ['/tabs/bounty-app?tab=messages&initialTab=inProgress', { tab: 'messages', initialTab: 'inProgress' }],
    ['/tabs/wallet-screen', { tab: 'wallet' }],
    ['/tabs/profile-screen', { tab: 'profile' }],
  ])('maps %s to a shell tab', (route, expected) => {
    expect(tabShellTargetForRoute(route)).toEqual(expected);
  });

  it.each(['/tabs/postings-screen?deliberateTap=1', '/wallet/connect/embedded-onboarding', '/bounty/1'])(
    'leaves %s alone',
    route => {
      expect(tabShellTargetForRoute(route)).toBeNull();
    }
  );
});

describe('useReturnToTabShell', () => {
  let returnToTabShell: (target?: TabShellTarget) => void = () => {};
  function Probe() {
    returnToTabShell = useReturnToTabShell();
    return null;
  }

  // A screen's navigation two levels below the root, like a payout screen
  // inside the postings/[bountyId] stack.
  function fakeNavigation(rootState: object) {
    const calls: string[] = [];
    const root = {
      getParent: () => undefined,
      getState: () => rootState,
      dispatch: jest.fn((action: { target: string }) => calls.push(`pop:${action.target}`)),
    };
    const screen = { getParent: () => ({ getParent: () => root }) };
    return { screen, root, calls };
  }

  beforeEach(() => mockReplace.mockClear());

  const payoutOverThread = {
    key: 'root',
    index: 1,
    routes: [
      { key: 'tabs', name: 'tabs', state: shellStack('bounty-thread/[bountyId]') },
      { key: 'payout', name: 'postings/[bountyId]' },
    ],
  };

  it('switches the mounted shell to the tab first, then pops back to it', () => {
    const { screen, root, calls } = fakeNavigation(payoutOverThread);
    const off = onTabShellRequest(target => calls.push(`tab:${target.tab}/${target.initialTab}`));
    render(
      <NavigationContext.Provider value={screen as never}>
        <Probe />
      </NavigationContext.Provider>
    );

    returnToTabShell({ tab: 'messages', initialTab: 'inProgress' });
    off();

    expect(calls).toEqual(['tab:messages/inProgress', 'pop:tabs-stack', 'pop:root']);
    expect(root.dispatch).toHaveBeenCalledTimes(2);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('leaves the shell on its current tab when no tab is named', () => {
    const { screen, calls } = fakeNavigation(payoutOverThread);
    const off = onTabShellRequest(target => calls.push(`tab:${target.tab}`));
    render(
      <NavigationContext.Provider value={screen as never}>
        <Probe />
      </NavigationContext.Provider>
    );

    returnToTabShell();
    off();

    expect(calls).toEqual(['pop:tabs-stack', 'pop:root']);
  });

  it('opens a fresh shell on the tab when none is mounted', () => {
    const { screen, root } = fakeNavigation({
      key: 'root',
      index: 0,
      routes: [{ key: 'payout', name: 'postings/[bountyId]' }],
    });
    render(
      <NavigationContext.Provider value={screen as never}>
        <Probe />
      </NavigationContext.Provider>
    );

    returnToTabShell({ tab: 'wallet' });

    expect(root.dispatch).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app?tab=wallet');
  });

  it('falls back to opening the shell outside a navigator', () => {
    render(<Probe />);
    returnToTabShell();
    expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app');
  });
});
