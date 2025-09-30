// lib/types-admin.ts - Admin-specific type definitions
import type { Money } from './types';

// Admin metrics overview
export interface AdminMetrics {
  totalBounties: number;
  openBounties: number;
  inProgressBounties: number;
  completedBounties: number;
  archivedBounties: number;
  totalUsers: number;
  totalEscrowVolume: Money;
  totalTransactions: number;
}

// Admin user summary (extended from UserProfile)
export interface AdminUserSummary {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  joinDate: string;
  verificationStatus?: 'unverified' | 'pending' | 'verified';
  bountiesPosted: number;
  bountiesAccepted: number;
  bountiesCompleted: number;
  totalSpent: Money;
  totalEarned: Money;
  balance: Money;
  status: 'active' | 'suspended' | 'banned';
}

// Admin bounty (extends base Bounty with admin fields)
export interface AdminBounty {
  id: string;
  user_id: string;
  title: string;
  description: string;
  amount?: Money;
  isForHonor?: boolean;
  location?: string;
  createdAt: string;
  status: 'open' | 'in_progress' | 'completed' | 'archived';
  acceptedBy?: string; // user_id of hunter
  flaggedCount?: number;
  lastModified?: string;
}

// Admin transaction view (read-only for now)
export interface AdminTransaction {
  id: string;
  type: 'escrow' | 'release' | 'refund' | 'deposit' | 'withdrawal';
  amount: Money;
  bountyId?: string;
  fromUserId?: string;
  toUserId?: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  description?: string;
}

// Filter options for admin lists
export interface AdminBountyFilters {
  status?: 'open' | 'in_progress' | 'completed' | 'archived' | 'all';
  flaggedOnly?: boolean;
}

export interface AdminUserFilters {
  status?: 'active' | 'suspended' | 'banned' | 'all';
  verificationStatus?: 'unverified' | 'pending' | 'verified' | 'all';
}

export interface AdminTransactionFilters {
  type?: 'escrow' | 'release' | 'refund' | 'deposit' | 'withdrawal' | 'all';
  status?: 'pending' | 'completed' | 'failed' | 'all';
}
