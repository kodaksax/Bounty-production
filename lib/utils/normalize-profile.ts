import type { AuthProfile } from "../services/auth-profile-service";
import type { UserProfile } from "../types";

export type NormalizedProfile = {
  id: string;
  username?: string;
  name?: string;
  avatar?: string;
  title?: string;
  bio?: string;
  languages?: string[];
  skills?: string[];
  joinDate?: string;
  created_at?: string;
  verificationStatus?: string;
  // counts
  followerCount?: number;
  followingCount?: number;
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
    languages: p.languages,
    skills: p.skills,
    joinDate: p.joinDate,
    verificationStatus: p.verificationStatus,
    followerCount: p.followerCount,
    followingCount: p.followingCount,
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
    languages: primary.languages || fallback.languages,
    skills: primary.skills || fallback.skills,
    joinDate: primary.joinDate || fallback.joinDate,
    created_at: primary.created_at || fallback.created_at,
    verificationStatus: primary.verificationStatus || fallback.verificationStatus,
    followerCount: primary.followerCount ?? fallback.followerCount,
    followingCount: primary.followingCount ?? fallback.followingCount,
    _raw: primary._raw || fallback._raw,
  };
}
