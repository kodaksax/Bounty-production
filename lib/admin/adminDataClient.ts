// lib/admin/adminDataClient.ts - Admin data client (Supabase-backed)
import { supabase } from '../supabase';
import type {
  AdminBounty,
  AdminBountyFilters,
  AdminMetrics,
  AdminTransaction,
  AdminTransactionFilters,
  AdminUserFilters,
  AdminUserSummary,
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

// Map DB row -> AdminBounty
function mapBounty(row: any): AdminBounty {
  return {
    id: row.id,
    user_id: row.creator_id ?? row.user_id ?? '',
    title: row.title ?? '',
    description: row.description ?? '',
    amount: row.amount ?? undefined,
    isForHonor: row.is_for_honor ?? row.isForHonor ?? false,
    location: row.location ?? undefined,
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    status: row.status ?? 'open',
    acceptedBy: row.hunter_id ?? undefined,
    flaggedCount: row.flagged_count ?? 0,
    lastModified: row.updated_at ?? undefined,
  };
}

// Map DB row -> AdminUserSummary
function mapUser(row: any): AdminUserSummary {
  return {
    id: row.id,
    username: row.username ?? row.full_name ?? 'Unknown',
    email: row.email ?? undefined,
    avatar: row.avatar_url ?? row.avatar ?? undefined,
    joinDate: row.created_at ?? new Date().toISOString(),
    verificationStatus: row.verification_status ?? 'unverified',
    bountiesPosted: row.bounties_posted ?? 0,
    bountiesAccepted: row.bounties_accepted ?? 0,
    bountiesCompleted: row.bounties_completed ?? 0,
    totalSpent: row.total_spent ?? 0,
    totalEarned: row.total_earned ?? 0,
    balance: row.balance ?? 0,
    status: row.status ?? 'active',
  };
}


// Admin data client – all methods require an active admin session (enforced by Supabase RLS)
export const adminDataClient = {
  // Fetch admin dashboard metrics
  async fetchAdminMetrics(): Promise<AdminMetrics> {
    const { data: bountyStats, error: bErr } = await supabase
      .from('bounties')
      .select('status');

    if (bErr) throw new Error(bErr.message);

    const bList = bountyStats ?? [];
    const totalBounties = bList.length;
    const openBounties = bList.filter((b: any) => b.status === 'open').length;
    const inProgressBounties = bList.filter((b: any) => b.status === 'in_progress').length;
    const completedBounties = bList.filter((b: any) => b.status === 'completed').length;
    const archivedBounties = bList.filter((b: any) => b.status === 'archived').length;

    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    const { count: totalTransactions } = await supabase
      .from('wallet_transactions')
      .select('id', { count: 'exact', head: true });

    return {
      totalBounties,
      openBounties,
      inProgressBounties,
      completedBounties,
      archivedBounties,
      totalUsers: totalUsers ?? 0,
      totalEscrowVolume: 0,
      totalTransactions: totalTransactions ?? 0,
    };
  },

  // Fetch bounties with optional status filter
  async fetchAdminBounties(filters?: AdminBountyFilters): Promise<AdminBounty[]> {
    let query = supabase
      .from('bounties')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    if (filters?.flaggedOnly) {
      query = query.gt('flagged_count', 0);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapBounty);
  },

  // Fetch single bounty by ID
  async fetchAdminBountyById(id: string): Promise<AdminBounty | null> {
    const { data, error } = await supabase
      .from('bounties')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    return data ? mapBounty(data) : null;
  },

  // Update bounty status (admin override)
  async updateBountyStatus(id: string, status: AdminBounty['status']): Promise<AdminBounty> {
    const { data, error } = await supabase
      .from('bounties')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return mapBounty(data);
  },

  // Remove a bounty for community guidelines violation (archives the bounty)
  async removeBountyForViolation(id: string): Promise<void> {
    const { error } = await supabase
      .from('bounties')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  },

  // Fetch users with optional status/verification filter
  async fetchAdminUsers(filters?: AdminUserFilters): Promise<AdminUserSummary[]> {
    let query = supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    if (filters?.verificationStatus && filters.verificationStatus !== 'all') {
      query = query.eq('verification_status', filters.verificationStatus);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapUser);
  },

  // Fetch single user by ID
  async fetchAdminUserById(id: string): Promise<AdminUserSummary | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    return data ? mapUser(data) : null;
  },

  // Update user account status (suspend/ban/restore)
  async updateUserStatus(id: string, status: AdminUserSummary['status']): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ status })
      .eq('id', id);

    if (error) throw new Error(error.message);
  },

  // Send a guideline warning to a user
  async sendWarning(params: SendWarningParams): Promise<void> {
    const { data: sessionData } = await supabase.auth.getSession();
    const adminId = sessionData?.session?.user?.id;
    if (!adminId) throw new Error('Not authenticated');

    // Explicitly verify that the authenticated user has admin privileges
    const { data: adminProfile, error: adminProfileError } = await supabase
      .from('profiles')
      .select('id, role, is_admin')
      .eq('id', adminId)
      .single();

    if (adminProfileError) {
      throw new Error(adminProfileError.message);
    }

    const isAdmin =
      (adminProfile as any)?.role === 'admin' ||
      (adminProfile as any)?.is_admin === true;

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

  // Fetch transactions (read-only)
  async fetchAdminTransactions(filters?: AdminTransactionFilters): Promise<AdminTransaction[]> {
    let query = supabase
      .from('wallet_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filters?.type && filters.type !== 'all') {
      query = query.eq('type', filters.type);
    }

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data ?? []).map((row: any): AdminTransaction => ({
      id: row.id,
      type: row.type,
      amount: row.amount ?? 0,
      bountyId: row.bounty_id ?? undefined,
      fromUserId: row.user_id ?? undefined,
      toUserId: row.to_user_id ?? undefined,
      status: row.status ?? 'completed',
      createdAt: row.created_at ?? new Date().toISOString(),
      description: row.description ?? undefined,
    }));
  },
};
