export type BountyStatus = "open" | "in_progress" | "completed" | "archived" | "deleted" | "cancelled" | "cancellation_requested";

export type Bounty = {
  id: string | number;  // uuid or numeric id
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location: string;
  // Optional ZIP code, saved as metadata so users with a matching profile
  // ZIP can eventually be matched/notified about this bounty.
  zip_code?: string;
  timeline: string;
  skills_required: string;
  poster_id: string;
  user_id?: string | null;  // Legacy column (NOT NULL in DB, but optional in API contract for backwards compatibility)
  created_at: string;
  status: BountyStatus;
  distance?: number;
  // New optional fields for enhanced posting metadata
  work_type?: 'online' | 'in_person';
  // Optional category selected by the poster at posting time (e.g. 'tech',
  // 'design', 'writing', 'labor', 'delivery', 'other'). See
  // lib/constants/bounty-categories.ts for the canonical list.
  category?: string;
  is_time_sensitive?: boolean;
  deadline?: string; // ISO date string when is_time_sensitive === true
  attachments_json?: string; // JSON serialized AttachmentMeta[] (storage format)
  // Rating aggregates for the bounty poster
  averageRating?: number;
  ratingCount?: number;
  // If a bounty has been accepted, store the accepting hunter's id (optional)
  accepted_by?: string;
  // Profile data from joined query (populated when fetched with profile join)
  username?: string;
  poster_avatar?: string;
  // Stale bounty fields
  is_stale?: boolean;
  stale_reason?: string;
  stale_detected_at?: string;
  // Stripe payment fields for escrow
  payment_intent_id?: string; // Stripe PaymentIntent ID for escrow
  // Structured schedule fields (Phase 1: time as first-class citizen)
  schedule_type?: 'asap' | 'scheduled' | 'flexible';
  start_date?: string;         // ISO 8601 timestamptz
  end_date?: string;           // ISO 8601 timestamptz (hard deadline)
  latest_arrival_time?: string; // ISO 8601 timestamptz
  duration_minutes?: number;
  conditional_end_note?: string;
}

// Lightweight attachment metadata for client state (stored serialized in attachments_json)
export interface AttachmentMeta {
  id: string // uuid or generated id
  name: string
  uri: string // local uri (upload pipeline TBD)
  mimeType?: string
  size?: number // bytes
  remoteUri?: string // where uploaded file is accessible (after upload)
  status?: 'pending' | 'uploading' | 'uploaded' | 'failed'
  progress?: number // 0-1
}

export type Profile = {
  id: string
  username: string
  avatar?: string
  avatar_url?: string // Legacy field, prefer 'avatar'
  about?: string | null
  phone?: string | null
  balance: number
  created_at: string
  email?: string | null
  updated_at?: string
  display_name?: string
  location?: string
  title?: string
  skills?: string[] // Array of skill names
  onboarding_completed?: boolean
  // Marketplace persona picked during onboarding ('poster' | 'hunter' | 'both').
  // Distinct from any platform authorization role.
  primary_role?: 'poster' | 'hunter' | 'both' | null
  // Which onboarding flow version this user completed — see
  // lib/context/onboarding-context.tsx CURRENT_ONBOARDING_VERSION.
  onboarding_version?: number | null
  // Progressive profile-completion tracking, e.g. { avatar: true, bio: false }.
  profile_completeness?: Record<string, boolean>
  // Withdrawal and cancellation tracking
  withdrawal_count?: number
  cancellation_count?: number
  // Aggregated rating stats (optional; populated by joined queries)
  averageRating?: number
  ratingCount?: number
  // Identity verification (Stripe Identity KYC)
  id_verification_status?: 'unverified' | 'pending' | 'verified' | 'rejected'
  selfie_submitted_at?: string
  // Stripe Connect payout account status. Distinct from `onboarding_completed`
  // (app onboarding) — see supabase/migrations/20260714c_rename_onboarding_complete_to_stripe_connect.sql.
  stripe_connect_onboarding_complete?: boolean
  stripe_connect_charges_enabled?: boolean
  stripe_connect_payouts_enabled?: boolean
  // Last time the user was observed active in-app (throttled). Drives
  // lib/moments/registry.ts's inactive_user_return moment.
  last_session_at?: string | null
}

export type Skill = {
  id: string;  // uuid in database
  user_id: string;
  icon: string;
  text: string;
  created_at: string;
}

export type BountyRequest = {
  id: string;  // uuid in database
  bounty_id: string;  // uuid reference
  hunter_id: string;
  poster_id?: string | null;  // denormalized poster reference for faster queries
  user_id?: string | null;  // legacy column; prefer hunter_id
  status: "pending" | "accepted" | "rejected";
  message?: string | null;  // optional pitch/cover message from the hunter
  created_at: string;
  updated_at?: string;
}

export type BountyCancellation = {
  id: string
  bounty_id: string  // uuid reference
  requester_id: string
  requester_type: 'poster' | 'hunter'
  reason: string
  status: 'pending' | 'accepted' | 'rejected' | 'disputed'
  responder_id?: string
  response_message?: string
  refund_amount?: number
  refund_percentage?: number
  created_at: string
  updated_at?: string
  resolved_at?: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, "id" | "created_at" | "updated_at">
        Update: Partial<Omit<Profile, "id" | "created_at">>
      }
      bounties: {
        Row: Bounty
        Insert: Omit<Bounty, "id" | "created_at">
        Update: Partial<Omit<Bounty, "id" | "created_at">>
      }
      skills: {
        Row: Skill
        Insert: Omit<Skill, "id" | "created_at">
        Update: Partial<Omit<Skill, "id" | "created_at">>
      }
      bounty_requests: {
        Row: BountyRequest
        Insert: Omit<BountyRequest, "id" | "created_at">
        Update: Partial<Omit<BountyRequest, "id" | "created_at">>
      }
    }
    Views: {
      [key: string]: {
        Row: Record<string, unknown>
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
    }
    Functions: {
      [key: string]: {
        Args: Record<string, unknown>
        Returns: unknown
      }
    }
  }
}
