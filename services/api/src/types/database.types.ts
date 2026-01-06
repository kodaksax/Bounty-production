export type BountyStatus = "open" | "in_progress" | "completed" | "archived" | "deleted" | "cancelled" | "cancellation_requested";

export type Bounty = {
  id: string;  // uuid in database
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location: string;
  timeline: string;
  skills_required: string;
  poster_id: string;
  user_id?: string | null;  // Legacy column (NOT NULL in DB, but optional in API contract for backwards compatibility)
  status: BountyStatus;
  work_type?: 'online' | 'in_person';
  is_time_sensitive?: boolean;
  deadline?: string | null;
  attachments_json?: string | null;
  created_at: string;
  updated_at?: string;
  // Extended fields (not in DB, added by queries/joins)
  distance?: number;
  averageRating?: number;
  ratingCount?: number;
  accepted_by?: string;
  username?: string;
  poster_avatar?: string;
  is_stale?: boolean;
  stale_reason?: string;
  stale_detected_at?: string;
  payment_intent_id?: string;
}

// Lightweight attachment metadata for client state (stored serialized in attachments_json)
export interface AttachmentMeta {
  id: string; // uuid or generated id
  name: string;
  uri: string; // local uri (upload pipeline TBD)
  mimeType?: string;
  size?: number; // bytes
  remoteUri?: string; // where uploaded file is accessible (after upload)
  status?: 'pending' | 'uploading' | 'uploaded' | 'failed';
  progress?: number; // 0-1
}

export type Profile = {
  id: string
  username: string
  avatar_url: string
  about: string
  phone: string
  balance: number
  created_at: string
  email?: string
  updated_at?: string
  display_name?: string
  location?: string
  onboarding_completed?: boolean
  // Withdrawal and cancellation tracking
  withdrawal_count?: number
  cancellation_count?: number
  // Aggregated rating stats (optional; populated by joined queries)
  averageRating?: number
  ratingCount?: number
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
  user_id?: string | null;  // legacy column; prefer hunter_id
  status: "pending" | "accepted" | "rejected";
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

/**
 * Supabase database schema for this project.
 *
 * This type mirrors the structure expected by `@supabase/supabase-js`:
 * - `public.Tables.<table>.Row` represents a row as returned from the database.
 * - `Insert` and `Update` represent the payload shapes for inserts and updates.
 *
 * Some tables in this schema may temporarily use loose stubs such as
 * `Record<string, unknown>` where the exact column types have not yet been modeled.
 * Those stubs should be replaced with proper, generated types as the schema
 * stabilizes.
 *
 * In the future, this type should ideally be generated directly from the
 * Supabase schema using the CLI:
 *
 *   supabase gen types typescript --project-id <project-id>
 *
 * Keeping this definition in sync with the actual database schema is critical
 * for end-to-end type safety across the API layer.
 */
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Profile, "id" | "created_at">>;
      };
      bounties: {
        Row: Bounty;
        // Note: `updated_at` is managed by the database (e.g. trigger/automatic timestamp)
        // and is therefore intentionally omitted from Insert/Update payloads.
        Insert: Omit<Bounty, "id" | "created_at" | "updated_at" | "distance" | "averageRating" | "ratingCount" | "accepted_by" | "username" | "poster_avatar" | "is_stale" | "stale_reason" | "stale_detected_at" | "payment_intent_id">;
        Update: Partial<Omit<Bounty, "id" | "created_at" | "distance" | "averageRating" | "ratingCount" | "username" | "poster_avatar">>;
      };
      skills: {
        Row: Skill;
        Insert: Omit<Skill, "id" | "created_at">;
        Update: Partial<Omit<Skill, "id" | "created_at">>;
      };
      bounty_requests: {
        Row: BountyRequest;
        // Note: `updated_at` is managed by the database via triggers
        Insert: Omit<BountyRequest, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<BountyRequest, "id" | "created_at">>;
      };
      // Additional tables used in consolidated routes
      wallet_transactions: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      outbox_events: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      stripe_events: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      completion_submissions: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      conversations: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      messages: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      conversation_participants: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
