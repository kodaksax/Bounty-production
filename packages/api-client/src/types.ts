import type { Bounty, Money } from '@bountyexpo/domain-types';

// Authentication types
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// API configuration
export interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
  
  // Token management callbacks
  getAccessToken?: () => string | null;
  getRefreshToken?: () => string | null;
  onTokenRefresh?: (tokens: AuthTokens) => void;
}

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Pagination
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  data: T[];
  pagination: PaginationInfo;
}

// Bounty-related request types
export interface GetBountiesOptions {
  page?: number;
  limit?: number;
  status?: string;
  location?: string;
  userId?: string;
  search?: string;
}

export interface CreateBountyRequest {
  title: string;
  description: string;
  amount: Money;
  is_for_honor: boolean;
  work_type?: string;
  timeline?: string;
  skills_required?: string;
  location?: string;
}

export interface AcceptBountyRequest {
  bountyId: number;
  message?: string;
}

export interface CompleteBountyRequest {
  bountyId: number;
  completionNote?: string;
  proof?: string;
}

// Bounty request/application type
export interface BountyRequest {
  id: string;
  bounty_id: string;
  user_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'completed';
  message?: string;
  created_at: string;
  updated_at: string;
}

// Extended bounty type with request info
export interface BountyWithRequest extends Bounty {
  request?: BountyRequest;
  applicant_count?: number;
}

// Export all types from domain-types for convenience
export type { Bounty, Money, BountyStatus } from '@bountyexpo/domain-types';