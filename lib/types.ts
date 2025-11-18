// lib/types.ts - Authoritative type definitions
export type Money = number; // USD for now

// Bounty Form Values
export interface BountyFormValues {
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location: string;
  timeline: string;
  skills_required: string;
  status: string;
}

// User Profile
export interface UserProfile {
  id: string;
  username: string;
  name?: string;
  avatar?: string;
  title?: string; // e.g., "Full Stack Developer"
  languages?: string[]; // e.g., ["English", "Spanish"]
  skills?: string[]; // e.g., ["React", "Node.js"]
  joinDate: string; // ISO date
  bio?: string;
  location?: string; // e.g., "San Francisco, CA"
  portfolio?: string; // Website or portfolio URL
  verificationStatus?: 'unverified' | 'pending' | 'verified';
  followerCount?: number;
  followingCount?: number;
}

// Follow relationship
export interface Follow {
  id: string;
  followerId: string; // user doing the following
  followingId: string; // user being followed
  createdAt: string;
}

// Alias for Follow (used in some contexts)
export type FollowEdge = Follow;

// Portfolio item
export interface PortfolioItem {
  id: string;
  userId: string;
  type: 'image' | 'video' | 'file';
  url: string; // remote URL for the item
  thumbnail?: string; // preview for images/videos if available
  title?: string;
  description?: string;
  name?: string; // original file name
  mimeType?: string; // content type (e.g., image/png, video/mp4, application/pdf)
  sizeBytes?: number; // file size, if known
  createdAt: string;
}

// Message
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  replyTo?: string; // ID of message being replied to
  mediaUrl?: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  isPinned?: boolean;
}

// Conversation
export interface Conversation {
  id: string;
  bountyId?: string;
  isGroup: boolean;
  name: string;
  avatar?: string;
  lastMessage?: string;
  updatedAt?: string;
  participantIds?: string[];
  unread?: number;
}

// User Rating
export interface UserRating {
  id: string;
  user_id: string; // ratee (person being rated)
  rater_id: string; // person giving the rating
  bountyId?: string;
  score: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  createdAt: string;
}

// Wallet Transaction
export interface WalletTransaction {
  id: string;
  type: "escrow" | "release" | "refund" | "deposit" | "withdrawal";
  amount: Money;
  bountyId?: string;
  createdAt: string;
  status?: "pending" | "completed" | "failed";
  disputeStatus?: "none" | "pending" | "resolved";
  details?: {
    title?: string;
    method?: string;
    counterparty?: string;
  };
}

// Location & Address Types
export interface SavedAddress {
  id: string;
  label: string; // e.g., "Home", "Office", "Studio"
  address: string; // Full address string
  latitude?: number;
  longitude?: number;
  createdAt: string;
}

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
}

export interface LocationPermissionState {
  granted: boolean;
  canAskAgain: boolean;
  status: 'granted' | 'denied' | 'undetermined';
}

export interface DistanceFilter {
  enabled: boolean;
  maxDistance: number; // in miles
  unit: 'miles' | 'km';
}

// Report Types
export interface Report {
  id: string;
  user_id: string; // reporter
  content_type: 'bounty' | 'profile' | 'message';
  content_id: string;
  reason: 'spam' | 'harassment' | 'inappropriate' | 'fraud';
  details?: string;
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  createdAt: string;
  updatedAt?: string;
}

export interface BlockedUser {
  id: string;
  blocker_id: string; // user who blocked
  blocked_id: string; // user who is blocked
  createdAt: string;
}

// Bounty Request
export interface Request {
  id: string;
  bountyId: string;
  hunterId: string;
  posterId?: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

// Bounty Cancellation
export interface BountyCancellation {
  id: string;
  bountyId: string;
  requesterId: string;
  requesterType: 'poster' | 'hunter';
  reason: string;
  status: 'pending' | 'accepted' | 'rejected' | 'disputed';
  responderId?: string;
  responseMessage?: string;
  refundAmount?: number;
  refundPercentage?: number;
  createdAt: string;
  updatedAt?: string;
  resolvedAt?: string;
}

// Bounty Dispute
export interface BountyDispute {
  id: string;
  cancellationId: string;
  bountyId: string;
  initiatorId: string;
  reason: string;
  evidence?: DisputeEvidence[];
  status: 'open' | 'under_review' | 'resolved' | 'closed';
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

// Dispute Evidence
export interface DisputeEvidence {
  id: string;
  type: 'text' | 'image' | 'document' | 'link';
  content: string;
  description?: string;
  uploadedAt: string;
}

// Attachment metadata for bounties
export interface Attachment {
  id: string;
  name: string;
  uri: string;
  mime?: string;
  mimeType?: string;
  size?: number;
  remoteUri?: string;
  status?: 'pending' | 'uploading' | 'uploaded' | 'failed';
  progress?: number;
}

// Notification Types
export type NotificationType = 'application' | 'acceptance' | 'completion' | 'payment' | 'message' | 'follow' | 'cancellation_request' | 'cancellation_accepted' | 'cancellation_rejected';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: {
    bountyId?: string;
    messageId?: string;
    userId?: string;
    hunterId?: string;
    senderId?: string;
    followerId?: string;
    amount?: number;
    cancellationId?: string;
    [key: string]: any;
  };
  read: boolean;
  created_at: string;
}

// Search & Filter Types
export type BountySortOption = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'distance_asc';
export type UserSortOption = 'relevance' | 'followers_desc' | 'date_desc';

export interface BountySearchFilters {
  keywords?: string;
  location?: string;
  minAmount?: number;
  maxAmount?: number;
  status?: string[];
  workType?: 'online' | 'in_person';
  isForHonor?: boolean;
  skills?: string[];
  sortBy?: BountySortOption;
  limit?: number;
  offset?: number;
}

export interface UserSearchFilters {
  keywords?: string;
  skills?: string[];
  location?: string;
  verificationStatus?: 'unverified' | 'pending' | 'verified';
  sortBy?: UserSortOption;
  limit?: number;
  offset?: number;
}

export interface SearchResult<T> {
  results: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface RecentSearch {
  id: string;
  type: 'bounty' | 'user';
  query: string;
  filters?: BountySearchFilters | UserSearchFilters;
  timestamp: string;
}