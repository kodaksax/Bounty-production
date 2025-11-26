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
  user_id: string;
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
