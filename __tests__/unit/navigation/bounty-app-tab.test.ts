/**
 * SBA-12: links into the tab shell name their tab with `?tab=`. expo-router
 * strips a param named `screen` (React Navigation's nested-navigator key), so
 * `?screen=` links landed on the Home feed. `screen` is still read as a
 * fallback for links built before the rename.
 */

import {
  bountyAppTabPath,
  isBountyAppTabPath,
  parseBountyAppTabParams,
  parseBountyAppTabUrl,
} from '../../../lib/navigation/bounty-app-tab';

describe('parseBountyAppTabParams', () => {
  it('reads the tab and the Inbox segment from `tab`', () => {
    expect(parseBountyAppTabParams({ tab: 'messages', initialTab: 'requests' })).toEqual({
      tab: 'messages',
      initialTab: 'requests',
    });
  });

  it('falls back to the legacy `screen` param', () => {
    expect(parseBountyAppTabParams({ screen: 'wallet' })).toEqual({ tab: 'wallet', initialTab: undefined });
  });

  it('prefers `tab` when both are present', () => {
    expect(parseBountyAppTabParams({ tab: 'messages', screen: 'wallet' }).tab).toBe('messages');
  });

  it('uses `screen` when `tab` is not a real tab', () => {
    expect(parseBountyAppTabParams({ tab: 'nope', screen: 'profile' }).tab).toBe('profile');
  });

  it('names no tab when neither is present, so the shell opens on the feed', () => {
    expect(parseBountyAppTabParams({})).toEqual({ tab: null, initialTab: undefined });
    expect(parseBountyAppTabParams({ initialTab: 'requests' })).toEqual({ tab: null, initialTab: 'requests' });
  });

  it('ignores unknown tabs and segments', () => {
    expect(parseBountyAppTabParams({ tab: 'settings', initialTab: 'archive' })).toEqual({
      tab: null,
      initialTab: undefined,
    });
    expect(parseBountyAppTabParams({ tab: '' }).tab).toBeNull();
  });

  it('takes the first value of a repeated param', () => {
    expect(parseBountyAppTabParams({ tab: ['wallet', 'profile'] }).tab).toBe('wallet');
  });
});

describe('bountyAppTabPath', () => {
  it('builds the link with `tab`, never `screen`', () => {
    expect(bountyAppTabPath('messages', 'requests')).toBe('/tabs/bounty-app?tab=messages&initialTab=requests');
    expect(bountyAppTabPath('wallet')).toBe('/tabs/bounty-app?tab=wallet');
  });

  it('round-trips through parseBountyAppTabUrl', () => {
    expect(parseBountyAppTabUrl(bountyAppTabPath('messages', 'requests'))).toEqual({
      tab: 'messages',
      initialTab: 'requests',
    });
  });
});

describe('parseBountyAppTabUrl', () => {
  it('reads a legacy `?screen=` path (stored navigation intents)', () => {
    expect(parseBountyAppTabUrl('/tabs/bounty-app?screen=postings&initialTab=requests')).toEqual({
      tab: 'postings',
      initialTab: 'requests',
    });
  });

  it('names no tab for a path without one', () => {
    expect(parseBountyAppTabUrl('/tabs/bounty-app')).toEqual({ tab: null, initialTab: undefined });
  });
});

describe('isBountyAppTabPath', () => {
  it('is true only for a tab-shell path that names a tab', () => {
    expect(isBountyAppTabPath('/tabs/bounty-app?tab=messages&initialTab=requests')).toBe(true);
    expect(isBountyAppTabPath('/tabs/bounty-app')).toBe(false);
    expect(isBountyAppTabPath('/postings/abc-123')).toBe(false);
    expect(isBountyAppTabPath('/tabs/messenger/conv-1')).toBe(false);
  });
});

// Pins the cause. If an expo-router upgrade stops stripping `screen`, this
// fails and the fallback reasoning in lib/navigation/bounty-app-tab.ts can be
// revisited; if it ever starts stripping `tab`, this fails too.
// routing.js's other imports touch native/DOM modules this pure function
// never uses, so they are stubbed.
jest.mock('expo/dom', () => ({}));
jest.mock('expo-linking', () => ({}));
jest.mock('expo-router/build/global-state/router-store', () => ({}));
jest.mock('expo-router/build/domComponents/emitDomEvent', () => ({}));
jest.mock('expo-router/build/getRoutesRedirects', () => ({}));

describe('expo-router navigation payloads (root cause)', () => {
  const { getPayloadFromStateRoute } = require('expo-router/build/global-state/routing');

  const leaf = (params: Record<string, string>) => ({ name: 'bounty-app', params });

  it('drops a `screen` param from the action router.push / router.replace dispatch', () => {
    const payload = getPayloadFromStateRoute(leaf({ screen: 'messages', initialTab: 'requests' }));
    expect(payload.params).toEqual({ initialTab: 'requests' });
  });

  it('keeps a `tab` param', () => {
    const payload = getPayloadFromStateRoute(leaf({ tab: 'messages', initialTab: 'requests' }));
    expect(payload.params).toEqual({ tab: 'messages', initialTab: 'requests' });
  });

  it('drops `screen` when the action starts at the parent stack too', () => {
    const payload = getPayloadFromStateRoute({
      name: 'tabs',
      state: { routes: [leaf({ screen: 'messages', initialTab: 'requests' })] },
    });
    expect(payload.params.params).toEqual({ initialTab: 'requests' });
  });
});
