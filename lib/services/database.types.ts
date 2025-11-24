export type Bounty = {
  id: number
  title: string
  description: string
  amount: number
  is_for_honor: boolean
  location: string
  timeline: string
  skills_required: string
  poster_id: string
  // Backwards-compatible alias for older code expecting user_id
  user_id?: string
  created_at: string
  status: "open" | "in_progress" | "completed" | "archived" | "deleted" | "cancelled" | "cancellation_requested"
  distance?: number
  // New optional fields for enhanced posting metadata
  work_type?: 'online' | 'in_person'
  is_time_sensitive?: boolean
  deadline?: string // ISO date string when is_time_sensitive === true
  attachments_json?: string // JSON serialized AttachmentMeta[] (storage format)
  // Rating aggregates for the bounty poster
  averageRating?: number
  ratingCount?: number
  // If a bounty has been accepted, store the accepting hunter's id (optional)
  accepted_by?: string
  // Profile data from joined query (populated when fetched with profile join)
  username?: string
  poster_avatar?: string
  // Stale bounty fields
  is_stale?: boolean
  stale_reason?: string
  stale_detected_at?: string
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
  id: number
  user_id: string
  icon: string
  text: string
  created_at: string
}

export type BountyRequest = {
  id: number
  bounty_id: number
  hunter_id: string
  status: "pending" | "accepted" | "rejected"
  created_at: string
}

export type BountyCancellation = {
  id: string
  bounty_id: number
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
