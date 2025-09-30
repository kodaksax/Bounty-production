// Core types for the API client
export type Money = number; // USD for now

export interface Bounty {
  id: number;
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location: string;
  timeline: string;
  skills_required: string;
  user_id: string;
  created_at: string;
  status: "open" | "in_progress" | "completed" | "archived";
  distance?: number;
  work_type?: 'online' | 'in_person';
  is_time_sensitive?: boolean;
  deadline?: string; // ISO date string when is_time_sensitive === true
  attachments_json?: string; // JSON serialized AttachmentMeta[]
}

export interface BountyRequest {
  id: number;
  bounty_id: number;
  user_id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
}

// API request/response types
export interface CreateBountyRequest {
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location?: string;
  timeline?: string;
  skills_required?: string;
  work_type?: 'online' | 'in_person';
  is_time_sensitive?: boolean;
  deadline?: string;
  attachments_json?: string;
}

export interface GetBountiesOptions {
  status?: string;
  userId?: string;
  workType?: 'online' | 'in_person';
  page?: number;
  limit?: number;
}

export interface AcceptBountyRequest {
  bountyId: number;
  message?: string;
}

export interface CompleteBountyRequest {
  bountyId: number;
  completionNotes?: string;
  attachments?: string; // JSON serialized attachments
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error?: string;
}

// Auth types
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// API Client configuration
export interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
  onTokenRefresh?: (tokens: AuthTokens) => void;
  getAccessToken?: () => string | null;
  getRefreshToken?: () => string | null;
}