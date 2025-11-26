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
  // Admin section - Comprehensive routing architecture
  ADMIN: {
    // Root admin dashboard
    INDEX: '/(admin)',
    
    // User Management
    USERS: '/(admin)/users',
    USER_DETAIL: (id: string | number) => `/(admin)/user/${id}` as const,
    BLOCKED_USERS: '/(admin)/blocked-users',
    
    // Bounty Management
    BOUNTIES: '/(admin)/bounties',
    BOUNTY_DETAIL: (id: string | number) => `/(admin)/bounty/${id}` as const,
    
    // Financial & Transactions
    TRANSACTIONS: '/(admin)/transactions',
    
    // Analytics & Reporting
    ANALYTICS: '/(admin)/analytics',
    REPORTS: '/(admin)/reports',
    
    // Settings section
    SETTINGS: {
      INDEX: '/(admin)/settings',
      GENERAL: '/(admin)/settings/general',
      NOTIFICATIONS: '/(admin)/settings/notifications',
      SECURITY: '/(admin)/settings/security',
      AUDIT_LOG: '/(admin)/settings/audit-log',
    },
    
    // Support section
    SUPPORT: {
      INDEX: '/(admin)/support',
      HELP: '/(admin)/support/help',
      FEEDBACK: '/(admin)/support/feedback',
    },
    
    // Error/fallback routes
    NOT_FOUND: '/(admin)/not-found',
  },
} as const;

export type RouteValue = string | ((...args: any[]) => string);
export type AppRoutes = typeof ROUTES;
