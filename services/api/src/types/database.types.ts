export type BountyStatus = "open" | "in_progress" | "completed" | "archived" | "deleted" | "cancelled" | "cancellation_requested";

export type Bounty = {
  id: string  // uuid in database
  title: string
  description: string
  amount: number
  is_for_honor: boolean
  location: string | null
  timeline: string | null
  skills_required: string | null
  poster_id: string | null
  user_id: string  // NOT NULL in DB (legacy column)
  status: BountyStatus
  work_type?: 'online' | 'in_person'
  is_time_sensitive?: boolean
  deadline?: string | null
  attachments_json?: string | null
  created_at: string
  updated_at?: string
  // Extended fields (not in DB, added by queries/joins)
  distance?: number
  averageRating?: number
  ratingCount?: number
  accepted_by?: string
  username?: string
  poster_avatar?: string
  is_stale?: boolean
  stale_reason?: string
  stale_detected_at?: string
  payment_intent_id?: string
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
  id: string  // uuid in database
  user_id: string
  icon: string | null
  text: string
  created_at: string
}

export type BountyRequest = {
  id: string  // uuid in database
  bounty_id: string  // uuid reference
  hunter_id: string | null
  user_id: string  // NOT NULL (legacy column)
  status: "pending" | "accepted" | "rejected"
  created_at: string
  updated_at?: string
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
        Insert: Omit<Bounty, "id" | "created_at" | "updated_at" | "distance" | "averageRating" | "ratingCount" | "accepted_by" | "username" | "poster_avatar" | "is_stale" | "stale_reason" | "stale_detected_at" | "payment_intent_id">
        Update: Partial<Omit<Bounty, "id" | "created_at" | "distance" | "averageRating" | "ratingCount" | "username" | "poster_avatar">>
      }
      skills: {
        Row: Skill
        Insert: Omit<Skill, "id" | "created_at">
        Update: Partial<Omit<Skill, "id" | "created_at">>
      }
      bounty_requests: {
        Row: BountyRequest
        Insert: Omit<BountyRequest, "id" | "created_at" | "updated_at">
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
