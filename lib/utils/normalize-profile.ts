import type { AuthProfile } from "../services/auth-profile-service";
import type { UserProfile } from "../types";

export type NormalizedProfile = {
  id: string;
  username?: string;
  name?: string;
  avatar?: string;
  title?: string;
  bio?: string;
  location?: string;
  portfolio?: string;
  languages?: string[];
  skills?: string[];
  joinDate?: string;
  created_at?: string;
  verificationStatus?: string;
  // counts
  followerCount?: number;
  followingCount?: number;
  // Phase 1 verification fields
  phone_verified?: boolean;
  id_verification_status?: 'unverified' | 'pending' | 'verified' | 'rejected';
  selfie_submitted_at?: string;
  age_verified?: boolean;
  email_confirmed?: boolean;
  // Stripe Identity fields
  stripe_identity_status?: string;
  id_verification_rejection_reason?: string;
  verified_since?: string;
  display_name?: string;
  // raw - keep original for debugging
  _raw?: any;
};

/**
 * Derives the coarse badge-facing status from Stripe-Identity/legacy fields.
 *
 * IMPORTANT: this replaces a previous passthrough of a `verificationStatus`
 * field that was actually sourced from `profiles.verification_status` -- an
 * unrelated column owned by the risk-management system (defaults to
 * 'pending' for every profile, never written to by the ID-verification
 * edge functions). That meant every cross-user verification badge
 * (applicant cards, messages, etc.) was effectively stuck showing "Pending"
 * regardless of real verification state. This derives the real status from
 * stripe_identity_status (new) / id_verification_status (legacy, for
 * profiles verified before the Stripe Identity migration) instead.
 */
function deriveCoarseVerificationStatus(
  stripeIdentityStatus?: string,
  legacyIdVerificationStatus?: string,
): string {
  if (stripeIdentityStatus === 'verified' || legacyIdVerificationStatus === 'verified') return 'verified';
  if (stripeIdentityStatus === 'processing') return 'pending';
  if (stripeIdentityStatus === 'requires_input') return 'rejected';
  if (legacyIdVerificationStatus === 'pending') return 'pending';
  if (legacyIdVerificationStatus === 'rejected') return 'rejected';
  return 'unverified';
}

export function normalizeAuthProfile(p: AuthProfile | null): NormalizedProfile | null {
  if (!p) return null;
  return {
    id: p.id,
    username: p.username,
    name: p.username, // AuthProfile may not have name field
    avatar: p.avatar || (p as any).avatar_url || undefined,
    bio: p.about,
    joinDate: p.created_at,
    created_at: p.created_at,
    verificationStatus: deriveCoarseVerificationStatus(p.stripe_identity_status, p.id_verification_status),
    followerCount: (p as any).followerCount,
    followingCount: (p as any).followingCount,
    phone_verified: p.phone_verified,
    id_verification_status: p.id_verification_status,
    selfie_submitted_at: p.selfie_submitted_at,
    age_verified: p.age_verified,
    email_confirmed: p.email_confirmed,
    stripe_identity_status: p.stripe_identity_status,
    id_verification_rejection_reason: p.id_verification_rejection_reason,
    verified_since: p.verified_since,
    display_name: p.display_name,
    _raw: p,
  };
}

export function authProfileToUserProfile(p: AuthProfile): UserProfile {
  return {
    id: p.id,
    username: p.username,
    name: p.display_name,
    avatar: p.avatar,
    title: p.title,
    skills: p.skills,
    bio: p.about,
    location: p.location,
    joinDate: p.created_at || new Date().toISOString(),
  };
}

export function normalizeUserProfile(p: UserProfile | null): NormalizedProfile | null {
  if (!p) return null;
  return {
    id: p.id,
    username: p.username?.replace(/^@/, ''),
    name: p.name || p.username,
    avatar: p.avatar || (p as any).avatar_url || undefined,
    title: p.title,
    bio: p.bio,
    location: p.location,
    portfolio: p.portfolio,
    languages: p.languages,
    skills: p.skills,
    joinDate: p.joinDate,
    verificationStatus: deriveCoarseVerificationStatus(p.stripe_identity_status, p.id_verification_status),
    followerCount: p.followerCount,
    followingCount: p.followingCount,
    phone_verified: p.phone_verified,
    id_verification_status: p.id_verification_status,
    selfie_submitted_at: p.selfie_submitted_at,
    age_verified: p.age_verified,
    email_confirmed: p.email_confirmed,
    stripe_identity_status: p.stripe_identity_status,
    id_verification_rejection_reason: p.id_verification_rejection_reason,
    verified_since: p.verified_since,
    display_name: p.display_name,
    _raw: p,
  };
}

export function mergeNormalized(primary: NormalizedProfile | null, fallback: NormalizedProfile | null): NormalizedProfile | null {
  if (!primary && !fallback) return null;
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    id: primary.id || fallback.id,
    username: primary.username || fallback.username,
    name: primary.name || fallback.name,
    avatar: primary.avatar || fallback.avatar,
    title: primary.title || fallback.title,
    bio: primary.bio || fallback.bio,
    location: primary.location || fallback.location,
    portfolio: primary.portfolio || fallback.portfolio,
    languages: primary.languages || fallback.languages,
    skills: primary.skills || fallback.skills,
    joinDate: primary.joinDate || fallback.joinDate,
    created_at: primary.created_at || fallback.created_at,
    verificationStatus: primary.verificationStatus || fallback.verificationStatus,
    followerCount: primary.followerCount ?? fallback.followerCount,
    followingCount: primary.followingCount ?? fallback.followingCount,
    phone_verified: primary.phone_verified ?? fallback.phone_verified,
    id_verification_status: primary.id_verification_status ?? fallback.id_verification_status,
    selfie_submitted_at: primary.selfie_submitted_at ?? fallback.selfie_submitted_at,
    age_verified: primary.age_verified ?? fallback.age_verified,
    email_confirmed: primary.email_confirmed ?? fallback.email_confirmed,
    stripe_identity_status: primary.stripe_identity_status ?? fallback.stripe_identity_status,
    id_verification_rejection_reason: primary.id_verification_rejection_reason ?? fallback.id_verification_rejection_reason,
    verified_since: primary.verified_since ?? fallback.verified_since,
    display_name: primary.display_name || fallback.display_name,
    _raw: primary._raw || fallback._raw,
  };
}
