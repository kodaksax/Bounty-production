// lib/admin/adminDataClient.ts - Admin data client (Supabase-backed)
//
// Column-mapping note (2026-08): the row mappers below used to read a set of
// columns that do not exist on the production schema --
// `bounties.creator_id`, `bounties.hunter_id`, `bounties.flagged_count`,
// `wallet_transactions.to_user_id`, and five `profiles.*` counter columns.
// Every one of those silently resolved to `undefined` and was then defaulted,
// so the admin panel rendered "Accepted By: (hidden)", "Flagged 0 times" and
// an all-zero user activity/financial summary regardless of the real data.
// The mappers now read the actual columns (`poster_id`, `accepted_by`,
// `user_id`/`receiver_id`) and the per-user aggregates are computed
// server-side by the admin-profiles Edge Function.
import { supabase } from '../supabase';
import {
  ADMIN_PAGE_SIZE,
  type AdminBounty,
  type AdminBountyFilters,
  type AdminBountyRelations,
  type AdminBountyRequest,
  type AdminCompletionSubmission,
  type AdminBountyStatus,
  type AdminMetrics,
  type AdminPage,
  type AdminTransaction,
  type AdminTransactionFilters,
  type AdminUserFilters,
  type AdminUserSummary,
} from '../types-admin';

// Violation types for guideline enforcement
export type ViolationType =
  | 'spam'
  | 'harassment'
  | 'inappropriate_content'
  | 'fraud'
  | 'guideline_violation'
  | 'other';

export interface SendWarningParams {
  userId: string;
  bountyId?: string;
  violationType: ViolationType;
  message: string;
}

/**
 * PostgREST rejects unescaped commas/parens inside an `or(...)` group, and a
 * `%` or `,` typed into an admin search box would otherwise either error the
 * request or silently widen the match. Strip the characters PostgREST treats
 * as structural and cap the length.
 */
function sanitizeSearchTerm(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/[(),*%\\]/g, ' ').replace(/\s+/g, ' ').slice(0, 120).trim();
}

function pageRange(filters?: { page?: number; pageSize?: number }): {
  from: number;
  to: number;
  pageSize: number;
} {
  const pageSize = Math.max(1, Math.min(filters?.pageSize ?? ADMIN_PAGE_SIZE, 200));
  const page = Math.max(0, filters?.page ?? 0);
  const from = page * pageSize;
  return { from, to: from + pageSize - 1, pageSize };
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Map DB row -> AdminBounty
function mapBounty(row: any): AdminBounty {
  const poster = row.poster ?? row.profiles ?? null;
  const hunter = row.hunter ?? null;
  return {
    id: row.id,
    // `poster_id` is the real column; `user_id` is a legacy duplicate that is
    // populated in lockstep, so it stays as a fallback for older rows.
    user_id: row.poster_id ?? row.user_id ?? '',
    posterUsername: poster?.username ?? poster?.display_name ?? row.username ?? undefined,
    title: row.title ?? '',
    description: row.description ?? '',
    amount: row.amount == null ? undefined : toNumber(row.amount),
    isForHonor: row.is_for_honor ?? false,
    location: row.location ?? undefined,
    category: row.category ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    status: (row.status ?? 'open') as AdminBountyStatus,
    acceptedBy: row.accepted_by ?? undefined,
    acceptedUsername: hunter?.username ?? hunter?.display_name ?? undefined,
    completedAt: row.completed_at ?? undefined,
    deadline: row.deadline ?? undefined,
    isStale: row.is_stale ?? false,
    staleReason: row.stale_reason ?? undefined,
    lastModified: row.updated_at ?? undefined,
  };
}

// Map DB row -> AdminUserSummary
function mapUser(row: any): AdminUserSummary {
  const stats = row.__stats ?? null;
  return {
    id: row.id,
    username: row.username ?? row.display_name ?? row.full_name ?? 'Unknown',
    displayName: row.display_name ?? row.full_name ?? undefined,
    email: row.email ?? undefined,
    avatar: row.avatar ?? undefined,
    joinDate: row.created_at ?? new Date().toISOString(),
    lastSeenAt: row.last_seen_at ?? row.last_session_at ?? undefined,
    verificationStatus: row.verification_status ?? 'unverified',
    bountiesPosted: toNumber(stats?.bountiesPosted),
    bountiesAccepted: toNumber(stats?.bountiesAccepted),
    bountiesCompleted: toNumber(stats?.bountiesCompleted),
    totalSpent: toNumber(stats?.totalSpent),
    totalEarned: toNumber(stats?.totalEarned),
    balance: toNumber(row.balance),
    balanceOnHold: toNumber(row.balance_on_hold),
    balanceFrozen: row.balance_frozen === true,
    status: (row.account_status ?? 'active') as AdminUserSummary['status'],
    statsLoaded: stats != null,
    restrictionReason: row.restriction_reason ?? undefined,
    stripeConnectAccountId: row.stripe_connect_account_id ?? undefined,
    payoutsEnabled: row.stripe_connect_payouts_enabled ?? row.payouts_enabled ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
  };
}

function mapTransaction(row: any): AdminTransaction {
  const from = row.from_profile ?? null;
  const to = row.to_profile ?? null;
  return {
    id: row.id,
    type: row.type,
    amount: toNumber(row.amount),
    bountyId: row.bounty_id ?? undefined,
    bountyTitle: row.bounty?.title ?? undefined,
    // `user_id` is the account the row is booked against. `sender_id` exists
    // on the table but has never been populated (0 rows), so it is not used.
    fromUserId: row.user_id ?? undefined,
    fromUsername: from?.username ?? from?.display_name ?? undefined,
    // Was `row.to_user_id` -- that column does not exist, so the "To" line
    // never rendered on any transaction.
    toUserId: row.receiver_id ?? undefined,
    toUsername: to?.username ?? to?.display_name ?? undefined,
    status: row.status ?? 'completed',
    createdAt: row.created_at ?? new Date().toISOString(),
    description: row.description ?? undefined,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? undefined,
    payoutMethod: row.payout_method ?? undefined,
  };
}

/** Statuses that represent a bounty an operator would consider "live". */
const ACTIVE_BOUNTY_STATUSES: AdminBountyStatus[] = ['open', 'in_progress'];

// Admin data client – all methods require an active admin session (enforced by Supabase RLS)
export const adminDataClient = {
  // Fetch admin dashboard metrics.
  //
  // Was: `select('status')` over the whole bounties table, counted in JS, with
  // `totalEscrowVolume` hardcoded to 0. That pulled every row on every
  // dashboard load and, because the JS counter only knew four of the seven
  // bounty_status_enum values, the per-status numbers did not add up to the
  // total. Now every number is a server-side count and escrow volume is real.
  async fetchAdminMetrics(): Promise<AdminMetrics> {
    const countOf = async (
      table: string,
      apply?: (q: any) => any
    ): Promise<number> => {
      let query = supabase.from(table).select('id', { count: 'exact', head: true });
      if (apply) query = apply(query);
      const { count, error } = await query;
      if (error) throw new Error(error.message);
      return count ?? 0;
    };

    const [
      totalBounties,
      openBounties,
      inProgressBounties,
      completedBounties,
      archivedBounties,
      cancelledBounties,
      deletedBounties,
      totalUsers,
      totalTransactions,
      failedTransactions,
      pendingRequests,
    ] = await Promise.all([
      countOf('bounties'),
      countOf('bounties', (q) => q.eq('status', 'open')),
      countOf('bounties', (q) => q.eq('status', 'in_progress')),
      countOf('bounties', (q) => q.eq('status', 'completed')),
      countOf('bounties', (q) => q.eq('status', 'archived')),
      countOf('bounties', (q) => q.in('status', ['cancelled', 'cancellation_requested'])),
      countOf('bounties', (q) => q.eq('status', 'deleted')),
      countOf('profiles', (q) => q.is('deleted_at', null)),
      countOf('wallet_transactions'),
      countOf('wallet_transactions', (q) => q.eq('status', 'failed')),
      countOf('bounty_requests', (q) => q.eq('status', 'pending')),
    ]);

    // Operational queues. These tables may be RLS-restricted or absent in some
    // environments; a failure here must not blank the whole dashboard, so each
    // degrades to 0 independently rather than rejecting the batch.
    const safeCount = async (table: string, apply?: (q: any) => any): Promise<number> => {
      try {
        return await countOf(table, apply);
      } catch {
        return 0;
      }
    };
    const [openDisputes, pendingReports, pendingWithdrawals] = await Promise.all([
      safeCount('bounty_disputes', (q) => q.in('status', ['open', 'pending', 'under_review', 'escalated'])),
      safeCount('reports', (q) => q.eq('status', 'pending')),
      safeCount('wallet_transactions', (q) => q.eq('type', 'withdrawal').eq('status', 'pending')),
    ]);

    const escrow = await this.fetchEscrowVolume();

    return {
      totalBounties,
      openBounties,
      inProgressBounties,
      completedBounties,
      archivedBounties,
      cancelledBounties,
      deletedBounties,
      totalUsers,
      totalEscrowVolume: escrow.lifetime,
      heldEscrowVolume: escrow.held,
      totalTransactions,
      openDisputes,
      pendingReports,
      pendingRequests,
      pendingWithdrawals,
      failedTransactions,
    };
  },

  /**
   * Escrow volume, derived from the wallet ledger rather than reported as 0.
   * `lifetime` is everything ever placed into escrow; `held` subtracts what has
   * since been released to a hunter or refunded to a poster, i.e. the money the
   * platform is currently holding on behalf of users.
   */
  async fetchEscrowVolume(): Promise<{ lifetime: number; held: number }> {
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('type, amount')
      .in('type', ['escrow', 'release', 'refund'])
      .eq('status', 'completed');

    if (error) throw new Error(error.message);

    let lifetime = 0;
    let released = 0;
    for (const row of (data ?? []) as any[]) {
      const amount = Math.abs(toNumber(row.amount));
      if (row.type === 'escrow') lifetime += amount;
      else released += amount;
    }
    return { lifetime, held: Math.max(0, lifetime - released) };
  },

  // Fetch bounties with filtering, search and pagination.
  async fetchAdminBounties(filters?: AdminBountyFilters): Promise<AdminPage<AdminBounty>> {
    const { from, to, pageSize } = pageRange(filters);
    let query = supabase
      .from('bounties')
      .select(
        'id, title, description, amount, is_for_honor, location, category, created_at, updated_at, completed_at, deadline, status, poster_id, user_id, accepted_by, is_stale, stale_reason, username',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    if (filters?.posterId) {
      query = query.eq('poster_id', filters.posterId);
    }
    if (filters?.hunterId) {
      query = query.eq('accepted_by', filters.hunterId);
    }
    if (filters?.staleOnly) {
      query = query.eq('is_stale', true);
    }

    const search = sanitizeSearchTerm(filters?.search);
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    const items = (data ?? []).map(mapBounty);
    await attachBountyPosterNames(items);
    const total = count ?? items.length;
    return { items, total, hasMore: from + pageSize < total };
  },

  // Fetch single bounty by ID
  async fetchAdminBountyById(id: string): Promise<AdminBounty | null> {
    const { data, error } = await supabase
      .from('bounties')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    const bounty = mapBounty(data);
    await attachBountyPosterNames([bounty]);
    return bounty;
  },

  /**
   * Counts of everything that hangs off a bounty, so the detail screen can
   * offer real cross-links ("3 requests", "1 dispute") instead of dead ends.
   * Individually fault-tolerant: a restricted or empty relation degrades to 0
   * rather than failing the whole detail screen.
   */
  async fetchBountyRelations(bountyId: string): Promise<AdminBountyRelations> {
    const count = async (table: string, apply?: (q: any) => any): Promise<number> => {
      try {
        let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('bounty_id', bountyId);
        if (apply) q = apply(q);
        const { count: c, error } = await q;
        if (error) throw error;
        return c ?? 0;
      } catch {
        return 0;
      }
    };

    const [requestCount, pendingRequestCount, transactionCount, completionSubmissionCount, disputeCount] =
      await Promise.all([
        count('bounty_requests'),
        count('bounty_requests', (q) => q.eq('status', 'pending')),
        count('wallet_transactions'),
        count('completion_submissions'),
        count('bounty_disputes'),
      ]);

    let openDisputeId: string | undefined;
    let conversationId: string | undefined;
    try {
      const { data } = await supabase
        .from('bounty_disputes')
        .select('id')
        .eq('bounty_id', bountyId)
        .order('created_at', { ascending: false })
        .limit(1);
      openDisputeId = (data as any[] | null)?.[0]?.id != null ? String((data as any[])[0].id) : undefined;
    } catch {
      /* relation unavailable — leave undefined */
    }
    try {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .eq('bounty_id', bountyId)
        .limit(1);
      conversationId = (data as any[] | null)?.[0]?.id ?? undefined;
    } catch {
      /* relation unavailable — leave undefined */
    }

    return {
      requestCount,
      pendingRequestCount,
      transactionCount,
      completionSubmissionCount,
      disputeCount,
      openDisputeId,
      conversationId,
    };
  },

  // Update bounty status (admin override)
  async updateBountyStatus(id: string, status: AdminBounty['status']): Promise<AdminBounty> {
    const { data, error } = await supabase
      .from('bounties')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new Error(error.message);
    // No returned row means RLS filtered the update out -- surface that rather
    // than reporting success for a write that never landed.
    if (!data) throw new Error('Bounty not found, or you do not have permission to update it');
    return mapBounty(data);
  },

  // Remove a bounty for community guidelines violation (archives the bounty)
  async removeBountyForViolation(id: string): Promise<void> {
    const { data, error } = await supabase
      .from('bounties')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('Bounty not found, or you do not have permission to remove it');
  },

  // Fetch users with filtering, search and pagination.
  // Goes through the admin-profiles Edge Function (service-role-backed,
  // admin-JWT-gated) rather than querying `profiles` directly with the
  // anon-key client -- see docs/withdrawals/08-profiles-rls-migration-strategy.md.
  async fetchAdminUsers(filters?: AdminUserFilters): Promise<AdminPage<AdminUserSummary>> {
    const { from, pageSize } = pageRange(filters);
    const { data, error } = await supabase.functions.invoke('admin-profiles', {
      body: {
        action: 'list',
        status: filters?.status,
        verificationStatus: filters?.verificationStatus,
        search: sanitizeSearchTerm(filters?.search) || undefined,
        page: filters?.page ?? 0,
        pageSize,
      },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);

    const items = ((data?.users ?? []) as any[]).map(mapUser);
    const total = toNumber(data?.total) || items.length;
    return { items, total, hasMore: from + pageSize < total };
  },

  // Fetch single user by ID (same admin-profiles Edge Function path).
  async fetchAdminUserById(id: string): Promise<AdminUserSummary | null> {
    const { data, error } = await supabase.functions.invoke('admin-profiles', {
      body: { action: 'getById', id },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data?.user ? mapUser(data.user) : null;
  },

  // Update user account status (suspend/ban/restore).
  // Was a direct anon-key `.update({ status })` -- `profiles` has no `status`
  // column (the real one is `account_status`) and every UPDATE policy on
  // profiles is `auth.uid() = id`, so this failed for a different admin's
  // target user regardless. Now routed through the service-role
  // admin-profiles function, matching every other admin-panel write path.
  async updateUserStatus(id: string, status: AdminUserSummary['status'], reason: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke('admin-profiles', {
      body: { action: 'updateStatus', id, status, reason },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
  },

  // Send a guideline warning to a user
  async sendWarning(params: SendWarningParams): Promise<void> {
    const { data: sessionData } = await supabase.auth.getSession();
    const adminId = sessionData?.session?.user?.id;
    if (!adminId) throw new Error('Not authenticated');

    // Explicitly verify that the authenticated user has admin privileges
    const { data: adminProfile, error: adminProfileError } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', adminId)
      .single();

    if (adminProfileError) {
      throw new Error(adminProfileError.message);
    }

    const isAdmin = (adminProfile as any)?.role === 'admin';

    if (!isAdmin) {
      throw new Error('Insufficient privileges: admin access required');
    }
    const { error: insertError } = await supabase
      .from('admin_warnings')
      .insert({
        admin_id: adminId,
        user_id: params.userId,
        bounty_id: params.bountyId ?? null,
        violation_type: params.violationType,
        message: params.message,
      })
      .select()
      .single();

    if (insertError) throw new Error(insertError.message);
  },

  // Fetch transactions (read-only) with filtering, search and pagination.
  async fetchAdminTransactions(
    filters?: AdminTransactionFilters
  ): Promise<AdminPage<AdminTransaction>> {
    const { from, to, pageSize } = pageRange(filters);
    let query = supabase
      .from('wallet_transactions')
      .select(
        'id, type, amount, bounty_id, description, status, created_at, user_id, receiver_id, stripe_payment_intent_id, payout_method',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (filters?.type && filters.type !== 'all') {
      query = query.eq('type', filters.type);
    }
    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    if (filters?.bountyId) {
      query = query.eq('bounty_id', filters.bountyId);
    }
    if (filters?.userId) {
      query = query.or(`user_id.eq.${filters.userId},receiver_id.eq.${filters.userId}`);
    }

    const search = sanitizeSearchTerm(filters?.search);
    if (search) {
      query = query.or(
        `description.ilike.%${search}%,stripe_payment_intent_id.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    const items = (data ?? []).map(mapTransaction);
    await attachTransactionLabels(items);
    const total = count ?? items.length;
    return { items, total, hasMore: from + pageSize < total };
  },

  /**
   * Hunter applications for one bounty.
   *
   * `bounty_requests` holds 237 rows in production and had no admin surface at
   * all: an operator investigating "why did this bounty go to that hunter"
   * had no way to see who else applied.
   */
  async fetchBountyRequests(bountyId: string): Promise<AdminBountyRequest[]> {
    const { data, error } = await supabase
      .from('bounty_requests')
      .select('id, bounty_id, hunter_id, poster_id, status, message, created_at, accepted_at, rejected_at')
      .eq('bounty_id', bountyId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];
    const names = await lookupUsernames(
      [...new Set(rows.map((r) => r.hunter_id).filter(Boolean))] as string[]
    );

    return rows.map((row) => ({
      id: row.id,
      bountyId: row.bounty_id,
      hunterId: row.hunter_id ?? undefined,
      hunterUsername: row.hunter_id ? names.get(row.hunter_id) : undefined,
      posterId: row.poster_id ?? undefined,
      status: row.status ?? 'pending',
      message: row.message ?? undefined,
      createdAt: row.created_at ?? new Date().toISOString(),
      acceptedAt: row.accepted_at ?? undefined,
      rejectedAt: row.rejected_at ?? undefined,
    }));
  },

  /**
   * Completion submissions (proof of work) for one bounty. Read-only: the
   * accept/reject decision belongs to the poster and runs through the
   * `completion` Edge Function, which enforces the escrow-release rules. The
   * console surfaces the evidence so an operator can adjudicate a dispute; it
   * deliberately does not offer a shortcut around that flow.
   */
  async fetchBountyCompletions(bountyId: string): Promise<AdminCompletionSubmission[]> {
    const { data, error } = await supabase
      .from('completion_submissions')
      .select(
        'id, bounty_id, hunter_id, message, proof_items, status, poster_feedback, revision_count, submitted_at, reviewed_at, created_at'
      )
      .eq('bounty_id', bountyId)
      .order('submitted_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];
    const names = await lookupUsernames(
      [...new Set(rows.map((r) => r.hunter_id).filter(Boolean))] as string[]
    );

    return rows.map((row) => ({
      id: row.id,
      bountyId: row.bounty_id,
      hunterId: row.hunter_id ?? undefined,
      hunterUsername: row.hunter_id ? names.get(row.hunter_id) : undefined,
      message: row.message ?? undefined,
      // `proof_items` is jsonb and has held both a bare array and a
      // `{ items: [...] }` wrapper across schema revisions; normalise so the
      // screen never crashes on the older shape.
      proofItems: normalizeProofItems(row.proof_items),
      status: row.status ?? 'pending',
      posterFeedback: row.poster_feedback ?? undefined,
      revisionCount: toNumber(row.revision_count),
      submittedAt: row.submitted_at ?? row.created_at ?? new Date().toISOString(),
      reviewedAt: row.reviewed_at ?? undefined,
    }));
  },

  /** Bounty counts by status for one user, used by the user-detail cross-links. */
  async fetchUserBountyBreakdown(
    userId: string
  ): Promise<{ posted: number; hunting: number; activeAsPoster: number }> {
    const count = async (apply: (q: any) => any): Promise<number> => {
      try {
        const { count: c, error } = await apply(
          supabase.from('bounties').select('id', { count: 'exact', head: true })
        );
        if (error) throw error;
        return c ?? 0;
      } catch {
        return 0;
      }
    };
    const [posted, hunting, activeAsPoster] = await Promise.all([
      count((q) => q.eq('poster_id', userId)),
      count((q) => q.eq('accepted_by', userId)),
      count((q) => q.eq('poster_id', userId).in('status', ACTIVE_BOUNTY_STATUSES)),
    ]);
    return { posted, hunting, activeAsPoster };
  },
};

/**
 * `completion_submissions.proof_items` is untyped jsonb written by several
 * app versions: an array of strings, an array of `{ url, type }` objects, or a
 * `{ items: [...] }` wrapper. Normalise to a display-ready list rather than
 * letting an older row crash the screen.
 */
function normalizeProofItems(raw: unknown): { label: string; url?: string }[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).items)
      ? (raw as any).items
      : [];

  return (list as unknown[]).map((item, index) => {
    if (typeof item === 'string') return { label: item, url: item };
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const url = typeof obj.url === 'string' ? obj.url : undefined;
      const label =
        (typeof obj.name === 'string' && obj.name) ||
        (typeof obj.type === 'string' && obj.type) ||
        url ||
        `Attachment ${index + 1}`;
      return { label: String(label), url };
    }
    return { label: `Attachment ${index + 1}` };
  });
}

/**
 * Resolve poster/hunter usernames for a page of bounties in a single round
 * trip. Kept out of the main select because `bounties` has no FK-backed
 * PostgREST embed to `profiles` for `accepted_by`, so an embedded select would
 * fail rather than return partial data.
 */
async function attachBountyPosterNames(items: AdminBounty[]): Promise<void> {
  const ids = new Set<string>();
  for (const b of items) {
    if (b.user_id) ids.add(b.user_id);
    if (b.acceptedBy) ids.add(b.acceptedBy);
  }
  if (ids.size === 0) return;

  const names = await lookupUsernames([...ids]);
  for (const b of items) {
    b.posterUsername = b.posterUsername ?? (b.user_id ? names.get(b.user_id) : undefined);
    b.acceptedUsername = b.acceptedBy ? names.get(b.acceptedBy) : undefined;
  }
}

/** Resolve counterparty usernames and bounty titles for a page of transactions. */
async function attachTransactionLabels(items: AdminTransaction[]): Promise<void> {
  const userIds = new Set<string>();
  const bountyIds = new Set<string>();
  for (const t of items) {
    if (t.fromUserId) userIds.add(t.fromUserId);
    if (t.toUserId) userIds.add(t.toUserId);
    if (t.bountyId) bountyIds.add(t.bountyId);
  }

  const [names, titles] = await Promise.all([
    userIds.size ? lookupUsernames([...userIds]) : Promise.resolve(new Map<string, string>()),
    bountyIds.size ? lookupBountyTitles([...bountyIds]) : Promise.resolve(new Map<string, string>()),
  ]);

  for (const t of items) {
    t.fromUsername = t.fromUserId ? names.get(t.fromUserId) : undefined;
    t.toUsername = t.toUserId ? names.get(t.toUserId) : undefined;
    t.bountyTitle = t.bountyId ? titles.get(t.bountyId) : undefined;
  }
}

/**
 * Best-effort username lookup. A missing or restricted profile leaves the id
 * unresolved rather than failing the list -- an operator would rather see a
 * truncated id than an error screen.
 */
async function lookupUsernames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', ids);
    if (error) throw error;
    for (const row of (data ?? []) as any[]) {
      const label = row.username ?? row.display_name;
      if (label) map.set(row.id, label);
    }
  } catch {
    /* leave ids unresolved */
  }
  return map;
}

async function lookupBountyTitles(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data, error } = await supabase.from('bounties').select('id, title').in('id', ids);
    if (error) throw error;
    for (const row of (data ?? []) as any[]) {
      if (row.title) map.set(row.id, row.title);
    }
  } catch {
    /* leave ids unresolved */
  }
  return map;
}

// Exported for unit tests: these are the pure mapping/sanitizing helpers that
// the column-mapping regressions above lived in.
export const __adminDataClientInternals = {
  mapBounty,
  mapUser,
  mapTransaction,
  sanitizeSearchTerm,
  pageRange,
};
