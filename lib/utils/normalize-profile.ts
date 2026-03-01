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
  id_verification_status?: 'none' | 'pending' | 'approved' | 'rejected';
  selfie_submitted_at?: string;
  age_verified?: boolean;
  email_confirmed?: boolean;
  display_name?: string;
  // raw - keep original for debugging
  _raw?: any;
};

export function normalizeAuthProfile(p: AuthProfile | null): NormalizedProfile | null {
  if (!p) return null;
  return {
    id: p.id,
    username: p.username,
    name: p.username, // AuthProfile may not have name field
    avatar: p.avatar,
    bio: p.about,
    joinDate: p.created_at,
    created_at: p.created_at,
    verificationStatus: (p as any).verificationStatus as string | undefined,
    followerCount: (p as any).followerCount,
    followingCount: (p as any).followingCount,
    _raw: p,
  };
}

export function normalizeUserProfile(p: UserProfile | null): NormalizedProfile | null {
  if (!p) return null;
  return {
    id: p.id,
    username: p.username?.replace(/^@/, ''),
    name: p.name || p.username,
    avatar: p.avatar,
    title: p.title,
    bio: p.bio,
    location: p.location,
    portfolio: p.portfolio,
    languages: p.languages,
    skills: p.skills,
    joinDate: p.joinDate,
    verificationStatus: p.verificationStatus,
    followerCount: p.followerCount,
    followingCount: p.followingCount,
    phone_verified: p.phone_verified,
    id_verification_status: p.id_verification_status,
    selfie_submitted_at: p.selfie_submitted_at,
    age_verified: p.age_verified,
    email_confirmed: p.email_confirmed,
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
    display_name: primary.display_name || fallback.display_name,
    _raw: primary._raw || fallback._raw,
  };
}
