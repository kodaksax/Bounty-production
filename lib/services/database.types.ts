export type Bounty = {
  id: number
  title: string
  description: string
  amount: number
  is_for_honor: boolean
  location: string
  timeline: string
  skills_required: string
  user_id: string
  created_at: string
  status: "open" | "in_progress" | "completed" | "archived"
  distance?: number
  // New optional fields for enhanced posting metadata
  work_type?: 'online' | 'in_person'
  is_time_sensitive?: boolean
  deadline?: string // ISO date string when is_time_sensitive === true
  attachments_json?: string // JSON serialized AttachmentMeta[] (storage format)
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
  user_id: string
  status: "pending" | "accepted" | "rejected"
  created_at: string
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
