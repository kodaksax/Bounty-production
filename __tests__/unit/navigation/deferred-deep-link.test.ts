/**
 * A notification opened during launch waits until the root gate has made its
 * first navigation, so the gate's router.replace can't replace it (SBA-12).
 */

import {
  __resetDeferredDeepLinksForTests,
  holdDeepLinks,
  openDeepLink,
  takeDeferredTabLink,
} from '../../../lib/navigation/deferred-deep-link';

const TAB_LINK = '/tabs/bounty-app?tab=messages&initialTab=requests';

describe('deferred deep links', () => {
  beforeEach(() => __resetDeferredDeepLinksForTests());

  it('opens immediately when no gate is holding (warm tap)', () => {
    const navigate = jest.fn();
    openDeepLink('/postings/abc', navigate);
    expect(navigate).toHaveBeenCalledWith('/postings/abc');
  });

  it('waits while the gate holds, then opens on release', () => {
    const release = holdDeepLinks();
    const navigate = jest.fn();
    openDeepLink('/postings/abc', navigate);
    expect(navigate).not.toHaveBeenCalled();
    release();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/postings/abc');
  });

  it('lets the gate take a waiting tab-shell link, which then is not opened again', () => {
    const release = holdDeepLinks();
    const navigate = jest.fn();
    openDeepLink(TAB_LINK, navigate);
    expect(takeDeferredTabLink()).toBe(TAB_LINK);
    expect(takeDeferredTabLink()).toBeNull();
    release();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not let the gate take a link outside the tab shell', () => {
    const release = holdDeepLinks();
    const navigate = jest.fn();
    openDeepLink('/postings/abc', navigate);
    expect(takeDeferredTabLink()).toBeNull();
    release();
    expect(navigate).toHaveBeenCalledWith('/postings/abc');
  });

  it('keeps only the latest link tapped while waiting', () => {
    const release = holdDeepLinks();
    const first = jest.fn();
    const second = jest.fn();
    openDeepLink('/postings/one', first);
    openDeepLink('/postings/two', second);
    release();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('/postings/two');
  });

  it('treats a second release as a no-op', () => {
    const release = holdDeepLinks();
    release();
    release();
    const navigate = jest.fn();
    openDeepLink('/postings/abc', navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
