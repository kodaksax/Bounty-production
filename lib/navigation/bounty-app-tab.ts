/**
 * Links into the tab shell (app/tabs/bounty-app.tsx): which bottom tab it
 * opens on and, for the Inbox, which segment.
 *
 * The tab rides in `?tab=`. It used to ride in `?screen=`, but expo-router
 * treats a param named `screen` as React Navigation's nested-navigator key
 * and drops it, on every platform: getPayloadFromStateRoute
 * (expo-router/build/global-state/routing.js) deletes it from every
 * router.push / router.replace, and routeInfo.js deletes it from web URLs. So
 * every `?screen=` link landed on the Home feed: "Review hunters", the
 * new-application notification, wallet links and the cold-start tab restore
 * (SBA-12). `screen` is still read as a fallback for links built before the
 * rename that reach the shell another way (stored navigation intents).
 */

import { ROUTES } from '../routes';

export const BOUNTY_APP_TABS = ['bounty', 'wallet', 'postings', 'profile', 'messages', 'admin'] as const;
export type BountyAppTab = (typeof BOUNTY_APP_TABS)[number];

/**
 * Inbox segments a link can ask for. 'requests' and 'myPostings' open My
 * Bounties (where a poster answers applications); 'inProgress' and 'new' open
 * My Work. See app/tabs/inbox-screen.tsx.
 */
export const INBOX_INITIAL_TABS = ['new', 'inProgress', 'myPostings', 'requests'] as const;
export type InboxInitialTab = (typeof INBOX_INITIAL_TABS)[number];

export interface BountyAppTabTarget {
  /** The tab the link asks for, or null when it names none (the shell then opens on the feed). */
  tab: BountyAppTab | null;
  initialTab?: InboxInitialTab;
}

const TAB_SET: ReadonlySet<string> = new Set(BOUNTY_APP_TABS);
const INBOX_SET: ReadonlySet<string> = new Set(INBOX_INITIAL_TABS);

function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asTab(value: unknown): BountyAppTab | null {
  const v = first(value);
  return v !== undefined && TAB_SET.has(v) ? (v as BountyAppTab) : null;
}

function asInboxTab(value: unknown): InboxInitialTab | undefined {
  const v = first(value);
  return v !== undefined && INBOX_SET.has(v) ? (v as InboxInitialTab) : undefined;
}

/** `/tabs/bounty-app?tab=<tab>[&initialTab=<segment>]` */
export function bountyAppTabPath(tab: BountyAppTab, initialTab?: InboxInitialTab): string {
  return `${ROUTES.TABS.BOUNTY_APP}?tab=${tab}${initialTab ? `&initialTab=${initialTab}` : ''}`;
}

/** Reads the shell's route params. `tab` wins; legacy `screen` is the fallback. */
export function parseBountyAppTabParams(params: {
  tab?: unknown;
  screen?: unknown;
  initialTab?: unknown;
}): BountyAppTabTarget {
  return {
    tab: asTab(params.tab) ?? asTab(params.screen),
    initialTab: asInboxTab(params.initialTab),
  };
}

/** Same as parseBountyAppTabParams, from a path such as `/tabs/bounty-app?tab=wallet`. */
export function parseBountyAppTabUrl(path: string): BountyAppTabTarget {
  try {
    const q = new URL(path, 'http://localhost').searchParams;
    return parseBountyAppTabParams({
      tab: q.get('tab') ?? undefined,
      screen: q.get('screen') ?? undefined,
      initialTab: q.get('initialTab') ?? undefined,
    });
  } catch {
    return { tab: null };
  }
}

/** True for a path into the tab shell that names a tab (`/tabs/bounty-app?tab=…`). */
export function isBountyAppTabPath(path: string): boolean {
  try {
    const u = new URL(path, 'http://localhost');
    return u.pathname === ROUTES.TABS.BOUNTY_APP && parseBountyAppTabUrl(path).tab !== null;
  } catch {
    return false;
  }
}
