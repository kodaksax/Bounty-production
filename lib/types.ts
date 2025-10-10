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
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
  title?: string;
  description?: string;
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
  type: "escrow" | "release" | "refund";
  amount: Money;
  bountyId?: string;
  createdAt: string;
  disputeStatus?: "none" | "pending" | "resolved";
}