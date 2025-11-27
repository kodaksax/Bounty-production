// lib/routes.ts - Centralized route name constants for navigation
// Grouped logically by domain; adjust paths if file-based routes move.

export const ROUTES = {
  ROOT: '/' as const,
  // Auth
  AUTH: {
    SIGN_IN: '/auth/sign-in',
    SIGN_UP: '/auth/sign-up-form',
  },
  // Tabs / main app surfaces
  TABS: {
    BOUNTY_APP: '/tabs/bounty-app', // entry wrapper if directly navigated
    MESSENGER: '/tabs/messenger-screen',
    POSTINGS: '/tabs/postings-screen',
    WALLET: '/tabs/wallet-screen',
    PROFILE: '/tabs/profile-screen',
    SEARCH: '/tabs/search',
  },
  // Bounty detail flows
  BOUNTY: {
    DASHBOARD: (id: string | number) => `/postings/${id}` as const,
    REVIEW_AND_VERIFY: (id: string | number) => `/postings/${id}/review-and-verify` as const,
    PAYOUT: (id: string | number) => `/postings/${id}/payout` as const,
  },
  // Admin section
  ADMIN: {
    INDEX: '/(admin)',
    BOUNTIES: '/(admin)/bounties',
    BOUNTY_DETAIL: (id: string | number) => `/(admin)/bounty/${id}` as const,
    USERS: '/(admin)/users',
    USER_DETAIL: (id: string | number) => `/(admin)/user/${id}` as const,
    TRANSACTIONS: '/(admin)/transactions',
    REPORTS: '/(admin)/reports',
    AUDIT_LOGS: '/(admin)/audit-logs',
  },
} as const;

export type RouteValue = string | ((...args: any[]) => string);
export type AppRoutes = typeof ROUTES;
