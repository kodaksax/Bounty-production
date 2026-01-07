/**
 * @fileoverview Authoritative type definitions for BountyExpo
 * 
 * This file serves as the single source of truth for all domain types
 * used throughout the application. Do not redefine these types elsewhere.
 * 
 * @module lib/types
 */

/**
 * Money type representing currency amounts in cents (USD)
 * 
 * @example
 * const bountyAmount: Money = 5000; // $50.00
 * const depositAmount: Money = 10000; // $100.00
 */
export type Money = number;

/**
 * Form values for creating or editing a bounty
 * 
 * @interface BountyFormValues
 * @property {string} title - Bounty title (10-200 characters)
 * @property {string} description - Detailed description (50-5000 characters)
 * @property {number} amount - Payment amount in cents
 * @property {boolean} is_for_honor - Whether this is an honor-based bounty (no payment)
 * @property {string} location - Location where work should be performed
 * @property {string} timeline - Expected completion timeline
 * @property {string} skills_required - Comma-separated list of required skills
 * @property {string} status - Current bounty status
 */
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

/**
 * User profile information
 * 
 * Represents a user's public and private profile data. Some fields are only
 * visible to the profile owner.
 * 
 * @interface UserProfile
 * @property {string} id - Unique user identifier (UUID)
 * @property {string} username - Unique username for the user
 * @property {string} [name] - User's display name
 * @property {string} [avatar] - URL to user's avatar image
 * @property {string} [title] - Professional title (e.g., "Full Stack Developer")
 * @property {string[]} [languages] - Languages spoken (e.g., ["English", "Spanish"])
 * @property {string[]} [skills] - Skills and expertise (e.g., ["React", "Node.js"])
 * @property {string} joinDate - ISO 8601 timestamp when user joined
 * @property {string} [bio] - User's biography or description
 * @property {string} [location] - Geographic location (e.g., "San Francisco, CA")
 * @property {string} [portfolio] - Website or portfolio URL
 * @property {'unverified' | 'pending' | 'verified'} [verificationStatus] - Account verification status
 * @property {number} [followerCount] - Number of users following this user
 * @property {number} [followingCount] - Number of users this user follows
 * 
 * @example
 * const profile: UserProfile = {
 *   id: "550e8400-e29b-41d4-a716-446655440000",
 *   username: "johndoe",
 *   name: "John Doe",
 *   title: "Full Stack Developer",
 *   skills: ["React", "Node.js", "TypeScript"],
 *   joinDate: "2024-01-01T00:00:00Z",
 *   bio: "Passionate about building great products",
 *   verificationStatus: "verified",
 *   followerCount: 150,
 *   followingCount: 75
 * };
 */
export interface UserProfile {
  id: string;
  username: string;
  name?: string;
  avatar?: string;
  title?: string;
  languages?: string[];
  skills?: string[];
  joinDate: string;
  bio?: string;
  location?: string;
  portfolio?: string;
  verificationStatus?: 'unverified' | 'pending' | 'verified';
  followerCount?: number;
  followingCount?: number;
}

/**
 * Follow relationship between two users
 * 
 * @interface Follow
 * @property {string} id - Unique identifier for the follow relationship
 * @property {string} followerId - ID of the user doing the following
 * @property {string} followingId - ID of the user being followed
 * @property {string} createdAt - ISO 8601 timestamp when follow relationship was created
 */
export interface Follow {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

/**
 * Alias for Follow interface (used in some graph contexts)
 * @typedef {Follow} FollowEdge
 */
export type FollowEdge = Follow;

/**
 * Portfolio item showcasing user's work
 * 
 * @interface PortfolioItem
 * @property {string} id - Unique identifier
 * @property {string} userId - ID of the user who owns this portfolio item
 * @property {'image' | 'video' | 'file'} type - Type of media
 * @property {string} url - Remote URL for the item
 * @property {string} [thumbnail] - Preview URL for images/videos
 * @property {string} [title] - Title of the portfolio item
 * @property {string} [description] - Description of the work
 * @property {string} [name] - Original file name
 * @property {string} [mimeType] - Content type (e.g., "image/png", "video/mp4")
 * @property {number} [sizeBytes] - File size in bytes
 * @property {string} createdAt - ISO 8601 timestamp when created
 */
export interface PortfolioItem {
  id: string;
  userId: string;
  type: 'image' | 'video' | 'file';
  url: string;
  thumbnail?: string;
  title?: string;
  description?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: string;
}

/**
 * Chat message within a conversation
 * 
 * @interface Message
 * @property {string} id - Unique message identifier
 * @property {string} conversationId - ID of the conversation this message belongs to
 * @property {string} senderId - ID of the user who sent the message
 * @property {string} text - Message content (max 5000 characters)
 * @property {string} createdAt - ISO 8601 timestamp when message was sent
 * @property {string} [replyTo] - ID of message being replied to (for threaded conversations)
 * @property {string} [mediaUrl] - URL to attached media (image, video, file)
 * @property {'sending' | 'sent' | 'delivered' | 'read' | 'failed'} [status] - Message delivery status
 * @property {boolean} [isPinned] - Whether message is pinned in conversation
 * 
 * @example
 * const message: Message = {
 *   id: "msg_123",
 *   conversationId: "conv_456",
 *   senderId: "user_789",
 *   text: "I'm interested in your bounty!",
 *   createdAt: "2024-01-01T12:00:00Z",
 *   status: "read"
 * };
 */
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  replyTo?: string;
  mediaUrl?: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  isPinned?: boolean;
}

/**
 * Conversation (chat) between users
 * 
 * Conversations are typically associated with a bounty but can also be
 * standalone direct messages.
 * 
 * @interface Conversation
 * @property {string} id - Unique conversation identifier
 * @property {string} [bountyId] - ID of associated bounty (if conversation is bounty-related)
 * @property {boolean} isGroup - Whether this is a group conversation
 * @property {string} name - Conversation name (e.g., "Bounty: Website Design")
 * @property {string} [avatar] - URL to conversation avatar/thumbnail
 * @property {string} [lastMessage] - Text of the most recent message
 * @property {string} [updatedAt] - ISO 8601 timestamp of last activity
 * @property {string[]} [participantIds] - Array of user IDs participating in conversation
 * @property {number} [unread] - Number of unread messages
 * 
 * @example
 * const conversation: Conversation = {
 *   id: "conv_123",
 *   bountyId: "bounty_456",
 *   isGroup: false,
 *   name: "Website Design Discussion",
 *   participantIds: ["user_1", "user_2"],
 *   lastMessage: "Sounds good, let's start!",
 *   updatedAt: "2024-01-01T12:30:00Z",
 *   unread: 2
 * };
 */
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

/**
 * User rating/review for completed bounty work
 * 
 * @interface UserRating
 * @property {string} id - Unique rating identifier
 * @property {string} user_id - ID of user being rated (the ratee)
 * @property {string} rater_id - ID of user giving the rating (the rater)
 * @property {string} [bountyId] - ID of bounty this rating is for
 * @property {1 | 2 | 3 | 4 | 5} score - Rating score (1-5 stars)
 * @property {string} [comment] - Optional written review
 * @property {string} createdAt - ISO 8601 timestamp when rating was created
 * 
 * @example
 * const rating: UserRating = {
 *   id: "rating_123",
 *   user_id: "hunter_456",
 *   rater_id: "poster_789",
 *   bountyId: "bounty_abc",
 *   score: 5,
 *   comment: "Excellent work, delivered ahead of schedule!",
 *   createdAt: "2024-01-01T15:00:00Z"
 * };
 */
export interface UserRating {
  id: string;
  user_id: string;
  rater_id: string;
  bountyId?: string;
  score: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  createdAt: string;
}

/**
 * Wallet transaction record
 * 
 * Represents any financial transaction in the user's wallet, including
 * deposits, withdrawals, escrow operations, and refunds.
 * 
 * @interface WalletTransaction
 * @property {string} id - Unique transaction identifier
 * @property {"escrow" | "release" | "refund" | "deposit" | "withdrawal"} type - Transaction type
 * @property {Money} amount - Transaction amount in cents (positive for credits, negative for debits)
 * @property {string} [bountyId] - Associated bounty ID (for bounty-related transactions)
 * @property {string} createdAt - ISO 8601 timestamp when transaction was created
 * @property {"pending" | "completed" | "failed"} [status] - Transaction status
 * @property {"none" | "pending" | "resolved"} [disputeStatus] - Dispute status if applicable
 * @property {Object} [details] - Additional transaction details
 * @property {string} [details.title] - Transaction description
 * @property {string} [details.method] - Payment method used
 * @property {string} [details.counterparty] - Other party in transaction
 * 
 * @example
 * // Deposit transaction
 * const deposit: WalletTransaction = {
 *   id: "txn_123",
 *   type: "deposit",
 *   amount: 10000,
 *   createdAt: "2024-01-01T10:00:00Z",
 *   status: "completed",
 *   disputeStatus: "none",
 *   details: {
 *     title: "Added funds via credit card",
 *     method: "Visa ending in 4242"
 *   }
 * };
 * 
 * // Escrow transaction
 * const escrow: WalletTransaction = {
 *   id: "txn_456",
 *   type: "escrow",
 *   amount: -5000,
 *   bountyId: "bounty_789",
 *   createdAt: "2024-01-01T11:00:00Z",
 *   status: "completed",
 *   disputeStatus: "none",
 *   details: {
 *     title: "Escrowed for bounty",
 *     counterparty: "johndoe"
 *   }
 * };
 */
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

/**
 * Notification type enumeration
 * 
 * Defines all possible notification types in the system.
 * 
 * @typedef {'application' | 'acceptance' | 'completion' | 'payment' | 'message' | 'follow' | 'cancellation_request' | 'cancellation_accepted' | 'cancellation_rejected' | 'dispute_created' | 'dispute_resolved' | 'stale_bounty' | 'stale_bounty_cancelled' | 'stale_bounty_reposted'} NotificationType
 * 
 * - **application**: Someone applied to your bounty
 * - **acceptance**: Your bounty application was accepted
 * - **completion**: A bounty you're involved in was completed
 * - **payment**: Payment received or processed
 * - **message**: New chat message received
 * - **follow**: Someone followed you
 * - **cancellation_request**: Cancellation requested for bounty
 * - **cancellation_accepted**: Cancellation request was accepted
 * - **cancellation_rejected**: Cancellation request was rejected
 * - **dispute_created**: Dispute was created
 * - **dispute_resolved**: Dispute was resolved
 * - **stale_bounty**: Your bounty has been inactive
 * - **stale_bounty_cancelled**: Stale bounty was cancelled
 * - **stale_bounty_reposted**: Stale bounty was reposted
 */
export type NotificationType = 'application' | 'acceptance' | 'completion' | 'payment' | 'message' | 'follow' | 'cancellation_request' | 'cancellation_accepted' | 'cancellation_rejected' | 'dispute_created' | 'dispute_resolved' | 'stale_bounty' | 'stale_bounty_cancelled' | 'stale_bounty_reposted';

/**
 * User notification
 * 
 * @interface Notification
 * @property {string} id - Unique notification identifier
 * @property {string} user_id - ID of user receiving the notification
 * @property {NotificationType} type - Type of notification
 * @property {string} title - Notification title
 * @property {string} body - Notification body text
 * @property {Object} [data] - Additional data payload specific to notification type
 * @property {string} [data.bountyId] - Related bounty ID
 * @property {string} [data.messageId] - Related message ID
 * @property {string} [data.userId] - Related user ID
 * @property {string} [data.hunterId] - Related hunter ID
 * @property {string} [data.senderId] - Related sender ID
 * @property {string} [data.followerId] - Related follower ID
 * @property {number} [data.amount] - Related amount (for payment notifications)
 * @property {string} [data.cancellationId] - Related cancellation ID
 * @property {boolean} read - Whether notification has been read
 * @property {string} created_at - ISO 8601 timestamp when created
 * 
 * @example
 * const notification: Notification = {
 *   id: "notif_123",
 *   user_id: "user_456",
 *   type: "application",
 *   title: "New application on your bounty",
 *   body: "John Doe applied to your bounty 'Website Design'",
 *   data: {
 *     bountyId: "bounty_789",
 *     userId: "user_abc"
 *   },
 *   read: false,
 *   created_at: "2024-01-01T12:00:00Z"
 * };
 */
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

// Saved Search for alerts
export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  type: 'bounty' | 'user';
  query: string;
  filters?: BountySearchFilters | UserSearchFilters;
  alertsEnabled: boolean;
  createdAt: string;
  lastNotifiedAt?: string;
}

// Autocomplete suggestion
export interface AutocompleteSuggestion {
  id: string;
  type: 'bounty' | 'user' | 'skill';
  text: string;
  subtitle?: string;
  icon?: string;
}

// Trending bounty data
export interface TrendingBounty {
  id: string;
  title: string;
  description?: string;
  amount?: number;
  isForHonor?: boolean;
  viewCount: number;
  applicationCount: number;
  trendingScore: number;
  createdAt: string;
  posterUsername?: string;
  posterAvatar?: string;
}