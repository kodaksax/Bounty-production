import type { Bounty, BountyRequest, Profile } from "lib/services/database.types"
import { isSupabaseConfigured, supabase } from 'lib/supabase'
import { logger } from "lib/utils/error-logger"

export type BountyRequestWithDetails = BountyRequest & {
  bounty: Bounty
  profile: Profile
}

// API Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

export const bountyRequestService = {
  /**
   * Get a bounty request by ID
   */
  async getById(id: string | number): Promise<BountyRequest | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/bounty-requests/${id}`)
      if (!response.ok) {
        if (response.status === 404) {
          return null
        }
        throw new Error(`Failed to fetch bounty request: ${response.statusText}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error fetching bounty request by ID", { id, error })
      return null
    }
  },

  /**
   * Get all bounty requests with optional filters
   */
  async getAll(options?: { status?: string; bountyId?: string | number; userId?: string }): Promise<BountyRequest[]> {
    try {
      // Prefer Supabase when configured to keep UUID id types consistent with bounties
      if (isSupabaseConfigured) {
        let query = supabase
          .from('bounty_requests')
          .select('*')
          .order('created_at', { ascending: false })

        if (options?.status) query = query.eq('status', options.status)
  if (options?.bountyId) query = query.eq('bounty_id', String(options.bountyId))
        if (options?.userId) query = query.eq('user_id', options.userId)

        const { data, error } = await query
        if (error) throw error
        return (data as unknown as BountyRequest[]) ?? []
      }

      const params = new URLSearchParams()
      if (options?.status) params.append("status", options.status)
  if (options?.bountyId) params.append("bounty_id", String(options.bountyId))
      if (options?.userId) params.append("user_id", options.userId)

      const url = `${API_BASE_URL}/api/bounty-requests${params.toString() ? `?${params.toString()}` : ''}`
      const response = await fetch(url)
      if (!response.ok) {
        const body = await response.text().catch(() => '<no-body>')
        throw new Error(`Failed to fetch bounty requests: ${response.status} ${response.statusText} — ${body}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error fetching bounty requests", { options, error })
      return []
    }
  },

  /**
   * Get all bounty requests with details (bounty and profile data included)
   */
  async getAllWithDetails(options?: { status?: string; bountyId?: string | number; userId?: string }): Promise<BountyRequestWithDetails[]> {
    try {
      // Supabase-first: fetch requests, then join bounties and profiles client-side
      if (isSupabaseConfigured) {
        let rq = supabase
          .from('bounty_requests')
          .select('*')
          .order('created_at', { ascending: false })
        if (options?.status) rq = rq.eq('status', options.status)
  if (options?.bountyId) rq = rq.eq('bounty_id', String(options.bountyId))
        if (options?.userId) rq = rq.eq('user_id', options.userId)

        const { data: reqs, error } = await rq
        if (error) throw error
        const requests = (reqs as unknown as BountyRequest[]) ?? []
        if (requests.length === 0) return []

  const bountyIds = Array.from(new Set(requests.map(r => String((r as any).bounty_id)).filter(Boolean))) as string[]
  const userIds = Array.from(new Set(requests.map(r => String((r as any).user_id)).filter(Boolean))) as string[]

        const [{ data: bounties, error: bErr }, { data: profiles, error: pErr }] = await Promise.all([
          bountyIds.length ? supabase.from('bounties').select('*').in('id', bountyIds) : Promise.resolve({ data: [], error: null } as any),
          userIds.length ? supabase.from('profiles').select('*').in('id', userIds) : Promise.resolve({ data: [], error: null } as any),
        ])
        if (bErr) throw bErr
        if (pErr) throw pErr

        const bountyMap = new Map<string, Bounty>((bounties as any[]).map((b: any) => [b.id, b as Bounty]))
        const profileMap = new Map<string, Profile>((profiles as any[]).map((p: any) => [p.id, p as Profile]))

        const result: BountyRequestWithDetails[] = requests.map(r => ({
          ...(r as any),
          bounty: bountyMap.get(String((r as any).bounty_id)) as Bounty,
          profile: profileMap.get(String((r as any).user_id)) as Profile,
        }))
        return result
      }

      const params = new URLSearchParams()
      if (options?.status) params.append("status", options.status)
  if (options?.bountyId) params.append("bounty_id", String(options.bountyId))
      if (options?.userId) params.append("user_id", options.userId)

      // Backend returns joined bounty + profile details on the same endpoint
      const url = `${API_BASE_URL}/api/bounty-requests${params.toString() ? `?${params.toString()}` : ''}`
      const response = await fetch(url)
      if (!response.ok) {
        const body = await response.text().catch(() => '<no-body>')
        throw new Error(`Failed to fetch bounty requests (with details): ${response.status} ${response.statusText} — ${body}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error fetching bounty requests with details", { options, error })
      return []
    }
  },

  /**
   * Create a new bounty request
   */
  async create(request: Omit<BountyRequest, "id" | "created_at">): Promise<BountyRequest | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounty_requests')
          .insert(request)
          .select('*')
          .single()
        if (error) throw error
        return (data as unknown as BountyRequest) ?? null
      }
      const response = await fetch(`${API_BASE_URL}/api/bounty-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create bounty request: ${errorText}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error creating bounty request", { request, error })
      return null
    }
  },

  /**
   * Update a bounty request
   */
  async update(id: string | number, updates: Partial<Omit<BountyRequest, "id" | "created_at">>): Promise<BountyRequest | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounty_requests')
          .update(updates)
          .eq('id', String(id))
          .select('*')
          .single()
        if (error) throw error
        return (data as unknown as BountyRequest) ?? null
      }
      const response = await fetch(`${API_BASE_URL}/api/bounty-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to update bounty request: ${errorText}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error updating bounty request", { id, updates, error })
      return null
    }
  },

  /**
   * Delete a bounty request
   */
  async delete(id: string | number): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('bounty_requests')
          .delete()
          .eq('id', String(id))
        if (error) throw error
        return true
      }
      const response = await fetch(`${API_BASE_URL}/api/bounty-requests/${id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to delete bounty request: ${errorText}`)
      }
      return true
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error deleting bounty request", { id, error })
      return false
    }
  },

  /**
   * Update a bounty request's status
   */
  async updateStatus(id: string | number, status: "pending" | "accepted" | "rejected"): Promise<BountyRequest | null> {
    return this.update(id, { status })
  },

  /**
   * Get bounty requests by user ID
   */
  async getByUserId(userId: string): Promise<BountyRequest[]> {
    return this.getAll({ userId })
  },

  /**
   * Get bounty requests by bounty ID
   */
  async getByBountyId(bountyId: string | number): Promise<BountyRequest[]> {
    return this.getAll({ bountyId })
  },

  /**
   * Get pending bounty requests
   */
  async getPendingRequests(): Promise<BountyRequest[]> {
    return this.getAll({ status: "pending" })
  },

  /**
   * Get accepted bounty requests
   */
  async getAcceptedRequests(): Promise<BountyRequest[]> {
    return this.getAll({ status: "accepted" })
  },

  /**
   * Get rejected bounty requests
   */
  async getRejectedRequests(): Promise<BountyRequest[]> {
    return this.getAll({ status: "rejected" })
  },

  /**
   * Accept a bounty request
   */
  async acceptRequest(requestId: string | number): Promise<BountyRequest | null> {
    console.log(`🎯 Accepting bounty request ${requestId}...`);
    console.log(`💡 Note: If this is a paid bounty, escrow PaymentIntent creation will be triggered`);
    
    const result = await this.updateStatus(requestId, "accepted");
    
    if (result) {
      console.log(`✅ Bounty request ${requestId} accepted successfully`);
      console.log(`🔒 Escrow process initiated for paid bounties via outbox event processing`);
    }
    
    return result;
  },

  /**
   * Reject a bounty request
   */
  async rejectRequest(requestId: string | number): Promise<BountyRequest | null> {
    return this.updateStatus(requestId, "rejected")
  },
}
