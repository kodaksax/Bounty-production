/**
 * Going back to the tab shell (app/tabs/bounty-app.tsx) instead of opening a
 * new one.
 *
 * The root navigator is a native stack, and the shell stays mounted under
 * everything opened over it — the feed keeps its scroll position and filters,
 * the Inbox its segment, every tab its state. `router.push` or
 * `router.replace` to /tabs/bounty-app does not return to that shell: it
 * stacks a second, freshly mounted one on top (Home feed, scrolled to the top,
 * filters reset) and leaves the first alive underneath, so a later Back lands
 * on a stale copy. MomentsProvider's single-instance guard exists because of
 * exactly this.
 *
 * `router.dismissTo('/tabs/bounty-app')` is not enough either. It pops the
 * root back to `tabs`, but the shell's own stack can have something pushed
 * inside it (a bounty thread, search), and the nested navigate that follows
 * pushes a new shell there rather than popping to the old one. So this reads
 * the navigation state, finds the nearest mounted shell, and pops each stack
 * between it and the top by exact key and count.
 */
import { NavigationContext } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useContext } from 'react';
import { ROUTES } from '../routes';
import {
  bountyAppTabPath,
  parseBountyAppTabUrl,
  type BountyAppTab,
  type InboxInitialTab,
} from './bounty-app-tab';

/** The shell's route name inside the `tabs` stack. */
const SHELL_ROUTE = 'bounty-app';

type NavRoute = { key?: string; name: string; state?: NavState };
type NavState = { key?: string; index?: number; routes?: NavRoute[] };

export type PopAction = { type: 'POP'; payload: { count: number }; target: string };

export interface TabShellTarget {
  tab: BountyAppTab;
  initialTab?: InboxInitialTab;
}

/** One stack on the way down to the shell, and the index of the route the path continues through. */
type PathStep = { state: NavState; index: number };

function findShell(state: NavState | undefined): PathStep[] | null {
  const routes = state?.routes;
  if (!state || !routes?.length) return null;
  const top = state.index ?? routes.length - 1;
  // Newest first, so the shell nearest the top wins if there are several.
  for (let i = top; i >= 0; i--) {
    const route = routes[i];
    if (route.name === SHELL_ROUTE) return [{ state, index: i }];
    const inner = findShell(route.state);
    if (inner) return [{ state, index: i }, ...inner];
  }
  return null;
}

/**
 * The pops that bring the nearest mounted shell to the front, innermost stack
 * first (so the screen revealed is already the shell), or null when no shell
 * is mounted. An empty list means the shell is already on top.
 */
export function planReturnToTabShell(rootState: NavState | undefined): PopAction[] | null {
  const path = findShell(rootState);
  if (!path) return null;
  const pops: PopAction[] = [];
  for (const { state, index } of path) {
    const top = state.index ?? (state.routes?.length ?? 1) - 1;
    const count = top - index;
    if (count <= 0) continue;
    // A stack without a key can't be targeted; opening a fresh shell is the
    // safe fallback then.
    if (!state.key) return null;
    pops.push({ type: 'POP', payload: { count }, target: state.key });
  }
  return pops.reverse();
}

// ── Tab requests ───────────────────────────────────────────────────────────
// The mounted shell's tab is local state, so a return that also names a tab
// tells it directly rather than through route params (which it only re-reads
// when they change — returning to the tab it was opened with would be a no-op).

type TabShellListener = (target: TabShellTarget) => void;
const tabShellListeners = new Set<TabShellListener>();

/** Subscribe the mounted shell to tab requests. Returns the unsubscribe. */
export function onTabShellRequest(listener: TabShellListener): () => void {
  tabShellListeners.add(listener);
  return () => {
    tabShellListeners.delete(listener);
  };
}

function requestTab(target: TabShellTarget) {
  tabShellListeners.forEach(listener => listener(target));
}

/**
 * The shell tab a route stands for, for links that open a tab by its own
 * route: `/tabs/bounty-app[?tab=…]` (no tab means the feed), and the
 * standalone `/tabs/wallet-screen` / `/tabs/profile-screen` copies of a tab.
 * Null for anything else.
 */
export function tabShellTargetForRoute(route: string): TabShellTarget | null {
  let pathname: string;
  try {
    pathname = new URL(route, 'http://localhost').pathname;
  } catch {
    return null;
  }
  if (pathname === ROUTES.TABS.BOUNTY_APP) {
    const { tab, initialTab } = parseBountyAppTabUrl(route);
    return { tab: tab ?? 'bounty', initialTab };
  }
  if (pathname === ROUTES.TABS.WALLET) return { tab: 'wallet' };
  if (pathname === ROUTES.TABS.PROFILE) return { tab: 'profile' };
  return null;
}

type RootNavigation = {
  getParent?: () => RootNavigation | undefined;
  getState?: () => NavState;
  dispatch?: (action: PopAction) => void;
};

/**
 * Returns `returnToTabShell(target?)`: back to the mounted shell, switched to
 * `target.tab` when given (left on its current tab otherwise). With no shell
 * mounted (a cold deep link straight into a flow) it opens one, as the
 * `router.replace` it stands in for did.
 */
export function useReturnToTabShell() {
  const router = useRouter();
  const navigation = useContext(NavigationContext) as RootNavigation | undefined;

  return useCallback(
    (target?: TabShellTarget) => {
      let root = navigation;
      while (root?.getParent?.()) root = root.getParent();
      const pops = root?.getState && root.dispatch ? planReturnToTabShell(root.getState()) : null;
      if (!pops || !root?.dispatch) {
        router.replace(
          (target ? bountyAppTabPath(target.tab, target.initialTab) : ROUTES.TABS.BOUNTY_APP) as never
        );
        return;
      }
      // Switch first: the shell changes tab while still covered, so the pop
      // reveals the right one instead of sliding over to it afterwards.
      if (target) requestTab(target);
      const dispatch = root.dispatch;
      pops.forEach(action => dispatch(action));
    },
    [navigation, router]
  );
}
