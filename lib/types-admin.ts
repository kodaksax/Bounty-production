// lib/types-admin.ts - Admin-specific type definitions
import type { Money } from './types';

// ─── Canonical status vocabularies ────────────────────────────────────────
// These mirror the Postgres enums exactly (bounty_status_enum,
// wallet_tx_type_enum, wallet_tx_status_enum). The admin panel previously
// hardcoded a 4-value subset of bounty_status_enum, which made every
// `cancelled` / `cancellation_requested` / `deleted` bounty invisible to the
// dashboard counters and unreachable from the list filters.

export const ADMIN_BOUNTY_STATUSES = [
  'open',
  'in_progress',
  'completed',
  'archived',
  'cancelled',
  'cancellation_requested',
  'deleted',
] as const;
export type AdminBountyStatus = (typeof ADMIN_BOUNTY_STATUSES)[number];

export const ADMIN_TRANSACTION_TYPES = [
  'escrow',
  'release',
  'refund',
  'deposit',
  'withdrawal',
  'dispute_loss',
  'admin_adjustment',
] as const;
export type AdminTransactionType = (typeof ADMIN_TRANSACTION_TYPES)[number];

export const ADMIN_TRANSACTION_STATUSES = [
  'pending',
  'completed',
  'failed',
  'manually_paid',
] as const;
export type AdminTransactionStatus = (typeof ADMIN_TRANSACTION_STATUSES)[number];

export const ADMIN_USER_STATUSES = ['active', 'suspended', 'banned'] as const;
export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

// Shared shape for every paginated admin list. `total` is the server-side
// count for the *filtered* query (not the length of `items`), so screens can
// show "showing 25 of 1,240" and know whether another page exists.
export interface AdminPage<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export interface AdminPagination {
  /** Zero-based page index. */
  page?: number;
  /** Rows per page. Defaults to ADMIN_PAGE_SIZE. */
  pageSize?: number;
}

export const ADMIN_PAGE_SIZE = 25;

// Admin metrics overview
export interface AdminMetrics {
  totalBounties: number;
  openBounties: number;
  inProgressBounties: number;
  completedBounties: number;
  archivedBounties: number;
  cancelledBounties: number;
  deletedBounties: number;
  totalUsers: number;
  totalEscrowVolume: Money;
  /** Escrow currently held (escrow in, less release/refund out). */
  heldEscrowVolume: Money;
  totalTransactions: number;
  /** Operational queues that need an admin's attention right now. */
  openDisputes: number;
  pendingReports: number;
  pendingRequests: number;
  pendingWithdrawals: number;
  failedTransactions: number;
}

// Admin user summary (extended from UserProfile)
//
// NOTE on the activity/financial counters: `profiles` has no
// bounties_posted / bounties_accepted / bounties_completed / total_spent /
// total_earned columns and never has. They used to be read straight off the
// profile row, so every one of them rendered as a hard 0 for every user on
// both the list and the detail screen. They are now aggregated server-side by
// the admin-profiles Edge Function; `statsLoaded` says whether that
// aggregation ran for this record, so the UI can show "—" instead of a
// fabricated zero when it did not.
export interface AdminUserSummary {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  avatar?: string;
  joinDate: string;
  lastSeenAt?: string;
  verificationStatus?: 'unverified' | 'pending' | 'verified' | 'trusted';
  bountiesPosted: number;
  bountiesAccepted: number;
  bountiesCompleted: number;
  totalSpent: Money;
  totalEarned: Money;
  balance: Money;
  balanceOnHold: Money;
  balanceFrozen: boolean;
  status: AdminUserStatus;
  /** True when the aggregate activity/financial counters were computed. */
  statsLoaded: boolean;
  restrictionReason?: string;
  stripeConnectAccountId?: string;
  payoutsEnabled?: boolean;
  deletedAt?: string;
}

// Admin bounty (extends base Bounty with admin fields)
export interface AdminBounty {
  id: string;
  /** Poster (`bounties.poster_id`). */
  user_id: string;
  posterUsername?: string;
  title: string;
  description: string;
  amount?: Money;
  isForHonor?: boolean;
  location?: string;
  category?: string;
  createdAt: string;
  status: AdminBountyStatus;
  /** Hunter (`bounties.accepted_by`). */
  acceptedBy?: string;
  acceptedUsername?: string;
  completedAt?: string;
  deadline?: string;
  isStale?: boolean;
  staleReason?: string;
  lastModified?: string;
}

/**
 * A hunter's application for a bounty (`bounty_requests`). 237 of these exist
 * in production and, before this change, none of them were visible anywhere in
 * the admin console.
 */
export interface AdminBountyRequest {
  id: string;
  bountyId: string;
  hunterId?: string;
  hunterUsername?: string;
  posterId?: string;
  status: 'pending' | 'accepted' | 'rejected';
  message?: string;
  createdAt: string;
  acceptedAt?: string;
  rejectedAt?: string;
}

/** Proof-of-work submitted against a bounty (`completion_submissions`). */
export interface AdminCompletionSubmission {
  id: string;
  bountyId: string;
  hunterId?: string;
  hunterUsername?: string;
  message?: string;
  proofItems: { label: string; url?: string }[];
  status: string;
  posterFeedback?: string;
  revisionCount: number;
  submittedAt: string;
  reviewedAt?: string;
}

/** Everything hanging off a bounty that an operator may need to jump to. */
export interface AdminBountyRelations {
  requestCount: number;
  pendingRequestCount: number;
  transactionCount: number;
  completionSubmissionCount: number;
  disputeCount: number;
  openDisputeId?: string;
  conversationId?: string;
}

// Admin transaction view (read-only for now)
export interface AdminTransaction {
  id: string;
  type: AdminTransactionType;
  amount: Money;
  bountyId?: string;
  bountyTitle?: string;
  /** `wallet_transactions.user_id` — the account the row is booked against. */
  fromUserId?: string;
  fromUsername?: string;
  /** `wallet_transactions.receiver_id`. */
  toUserId?: string;
  toUsername?: string;
  status: AdminTransactionStatus;
  createdAt: string;
  description?: string;
  stripePaymentIntentId?: string;
  payoutMethod?: string;
}

// Filter options for admin lists
export interface AdminBountyFilters extends AdminPagination {
  status?: AdminBountyStatus | 'all';
  /** Free-text match against title/description. */
  search?: string;
  /** Restrict to one poster — powers the user-detail "their bounties" link. */
  posterId?: string;
  /** Restrict to one hunter. */
  hunterId?: string;
  /** Only bounties flagged stale by the expiry sweeper. */
  staleOnly?: boolean;
}

export interface AdminUserFilters extends AdminPagination {
  status?: AdminUserStatus | 'all';
  verificationStatus?: 'unverified' | 'pending' | 'verified' | 'trusted' | 'all';
  /** Free-text match against username/display name/email. */
  search?: string;
}

export interface AdminTransactionFilters extends AdminPagination {
  type?: AdminTransactionType | 'all';
  status?: AdminTransactionStatus | 'all';
  /** Free-text match against description / Stripe reference. */
  search?: string;
  /** Restrict to one bounty's ledger. */
  bountyId?: string;
  /** Restrict to one user's ledger (either side of the transfer). */
  userId?: string;
}

// Audit log entry types
export type AuditLogCategory = 
  | 'user'
  | 'bounty'
  | 'payment'
  | 'moderation'
  | 'system'
  | 'security';

export type AuditLogAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'banned'
  | 'restored'
  | 'login'
  | 'logout'
  | 'password_change'
  | 'email_verified'
  | 'payment_completed'
  | 'payment_failed'
  | 'refund_issued'
  | 'report_submitted'
  | 'report_resolved'
  | 'content_flagged'
  | 'content_removed'
  | 'user_blocked'
  | 'user_unblocked';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  category: AuditLogCategory;
  action: AuditLogAction;
  actorId?: string;
  actorName?: string;
  targetId?: string;
  targetType?: 'user' | 'bounty' | 'transaction' | 'report' | 'message';
  description: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface AuditLogFilters {
  category?: AuditLogCategory | 'all';
  severity?: 'info' | 'warning' | 'critical' | 'all';
  startDate?: string;
  endDate?: string;
  searchQuery?: string;
  actorId?: string;
}

// Enhanced report with priority scoring
export interface EnhancedReport {
  id: string;
  reporter_id: string;
  reporter_name?: string;
  content_type: 'bounty' | 'profile' | 'message';
  content_id: string;
  reason: 'spam' | 'harassment' | 'inappropriate' | 'fraud';
  details?: string;
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  created_at: string;
  updated_at?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  resolution_notes?: string;
}

export interface ReportStats {
  pending: number;
  reviewed: number;
  resolved: number;
  dismissed: number;
  critical: number;
  high: number;
}

// ─── Founder Command Center ───────────────────────────────────────────────
// Backed by public.bounty_events and the admin_* RPCs added in
// supabase/migrations/20260828130000_bounty_events_command_center.sql.

/**
 * Where an event came from. This is the distinction the whole Command Center
 * turns on, so it is a closed vocabulary rather than a free string:
 *
 *   app      APP EVENT            — our own tables recorded a user action
 *   system   SYSTEM EVENT         — a backend job acted
 *   stripe   STRIPE EVENT         — observed by reading the Stripe API
 *   webhook  WEBHOOK CONFIRMATION — a signature-verified Stripe webhook
 *   inferred INFERRED STATE       — reconstructed; NOT a confirmation
 */
export const ADMIN_EVENT_SOURCES = ['app', 'system', 'stripe', 'webhook', 'inferred'] as const;
export type AdminEventSource = (typeof ADMIN_EVENT_SOURCES)[number];

/** Human label for each provenance, as rendered on the timeline. */
export const ADMIN_EVENT_SOURCE_LABEL: Record<AdminEventSource, string> = {
  app: 'APP EVENT',
  system: 'SYSTEM EVENT',
  stripe: 'STRIPE EVENT',
  webhook: 'WEBHOOK CONFIRMATION',
  inferred: 'INFERRED STATE',
};

/**
 * Financial status is deliberately separate from `AdminBountyStatus`
 * (the marketplace status). A bounty can be `completed` and
 * `released_unverified` at the same time, and the console has to say so.
 */
export const ADMIN_FINANCIAL_STATUSES = [
  'not_applicable',
  'unfunded',
  'escrow_held',
  'release_pending',
  'released_unverified',
  'released_verified',
  'refunded',
  'completed_unfunded',
] as const;
export type AdminFinancialStatus = (typeof ADMIN_FINANCIAL_STATUSES)[number];

export interface AdminMarketplaceOverview {
  since: string;
  generatedAt: string;
  // Flow
  newBounties: number;
  newPosters: number;
  newHunters: number;
  newSignups: number;
  applications: number;
  accepts: number;
  completions: number;
  // Money
  completedGmv: Money;
  /** The part of `completedGmv` a Stripe webhook or stored Stripe id backs up. */
  verifiedGmv: Money;
  completedGmvLifetime: Money;
  verifiedGmvLifetime: Money;
  escrowHeld: Money;
  pendingFinancialEvents: number;
  unverifiedCompletions: number;
  payoutFailures: number;
  payoutFailuresLifetime: number;
  // Trust & safety
  suspiciousListings: number;
  suspiciousApplications: number;
  // Queues
  openDisputes: number;
  pendingReports: number;
  pendingWithdrawals: number;
  unprocessedWebhooks: number;
  failedWebhooks: number;
  openAnomalies: number;
}

export interface AdminLedgerEvent {
  id: string;
  eventKey: string;
  eventType: string;
  source: AdminEventSource;
  bountyId?: string;
  bountyTitle?: string;
  actorId?: string;
  actorUsername?: string;
  amount?: Money;
  correlationId?: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export type AdminAnomalySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AdminAnomaly {
  anomalyType: string;
  severity: AdminAnomalySeverity;
  entityType: string;
  entityId: string;
  bountyId?: string;
  userId?: string;
  amount?: Money;
  detectedAt: string;
  summary: string;
  detail: Record<string, unknown>;
}

export interface AdminBountyFinancialSummary {
  bountyId: string;
  marketplaceStatus: AdminBountyStatus;
  financialStatus: AdminFinancialStatus;
  /** True only when Stripe itself confirmed it. Never inferred. */
  stripeConfirmed: boolean;
  amount?: Money;
  escrowAmount: Money;
  releaseAmount: Money;
  refundAmount: Money;
  pendingLedgerCount: number;
  paymentRecords: number;
  webhookEvents: number;
}

export interface AdminCommandBountyDetail {
  id: string;
  title: string;
  description?: string;
  amount?: Money;
  isForHonor: boolean;
  category?: string;
  location?: string;
  createdAt: string;
  updatedAt?: string;
  deadline?: string;
  completedAt?: string;
  isStale: boolean;
  poster?: { id: string; username?: string; accountStatus?: string; riskLevel?: string };
  hunter?: { id: string; username?: string; accountStatus?: string; riskLevel?: string };
  marketplaceStatus: AdminBountyStatus;
  applications: number;
  applicationsPending: number;
  completionSubmissions: number;
  financial: AdminBountyFinancialSummary | null;
  moderation: {
    reports: number;
    reportsOpen: number;
    disputes: number;
    warnings: number;
    suspiciousReasons: string[];
  };
}

export interface AdminSuspiciousListing {
  bountyId: string;
  posterId?: string;
  title?: string;
  amount?: Money;
  status?: string;
  reason: string;
  severity: AdminAnomalySeverity;
  detectedAt: string;
}

export interface AdminSuspiciousApplication {
  requestId: string;
  bountyId?: string;
  hunterId?: string;
  status?: string;
  reason: string;
  severity: AdminAnomalySeverity;
  detectedAt: string;
}

export interface AdminFeedFilters {
  limit?: number;
  /** Keyset cursor: pass the last row's occurredAt/id to fetch the next page. */
  before?: string;
  beforeId?: string;
  sources?: AdminEventSource[];
  types?: string[];
  bountyId?: string;
  actorId?: string;
}
