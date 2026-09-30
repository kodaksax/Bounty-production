import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

/**
 * Tabs whose hardware back press is left alone: the feed is the destination,
 * and the Post tab's CreateBountyFlow owns back (previous step, then exit).
 */
const PASS_THROUGH_TABS = new Set(['bounty', 'postings']);

/**
 * Android hardware back for the tab shell (app/tabs/bounty-app.tsx).
 *
 * Its tabs are local state, not routes, so without this, back on Wallet,
 * Profile or My Bounties popped the whole shell and closed the app. This
 * returns to the feed first, like every other tabbed app.
 *
 * The listener exists only while the shell is the focused screen. The shell
 * stays mounted under anything pushed on top of it (a bounty detail opened
 * from Wallet), and a listener left active there would swallow that screen's
 * back press and switch tabs underneath it instead of popping it.
 */
export function useTabBackToFeed(activeScreen: string, onBackToFeed: () => void) {
  useFocusEffect(
    useCallback(() => {
      if (PASS_THROUGH_TABS.has(activeScreen)) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        onBackToFeed();
        return true;
      });
      return () => subscription.remove();
    }, [activeScreen, onBackToFeed])
  );
}
