import type { Bounty, BountyRequest, Profile } from "lib/services/database.types"
import { isSupabaseConfigured, supabase } from 'lib/supabase'
import { getApiBase } from 'lib/utils/dev-host'
import { logger } from "lib/utils/error-logger"

export type BountyRequestWithDetails = BountyRequest & {
  bounty: Bounty
  profile: Profile
}

// API Configuration
// Prefer explicit API base from env. In development, prefer a runtime-derived
// base (Expo debugger host, emulator fallback, etc.) to avoid "localhost"
// mismatches when running on device/emulator.
const API_BASE_URL = process.env.API_BASE_URL || (typeof __DEV__ !== 'undefined' && __DEV__ ? getApiBase() : 'http://localhost:3001');

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
      // Normalize thrown values (Supabase often throws plain objects)
      let error: Record<string, any>
      if (err instanceof Error) {
        error = { name: err.name, message: err.message, stack: err.stack }
      } else if (err && typeof err === 'object') {
        // Prefer any message property, then nested error.message, then JSON
        const message = (err as any).message || (err as any).error?.message || (() => {
          try { return JSON.stringify(err) } catch { return String(err) }
        })()
        error = { ...(err as Record<string, any>), message }
      } else {
        error = { message: String(err) }
      }
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
  if (options?.userId) query = query.eq('hunter_id', options.userId)

        const { data, error } = await query
        if (error) throw error
        return (data as unknown as BountyRequest[]) ?? []
      }

      const params = new URLSearchParams()
      if (options?.status) params.append("status", options.status)
  if (options?.bountyId) params.append("bounty_id", String(options.bountyId))
  if (options?.userId) params.append("hunter_id", options.userId)

      const url = `${API_BASE_URL}/api/bounty-requests${params.toString() ? `?${params.toString()}` : ''}`
      const response = await fetch(url)
      if (!response.ok) {
        const body = await response.text().catch(() => '<no-body>')
        throw new Error(`Failed to fetch bounty requests: ${response.status} ${response.statusText} — ${body}`)
      }
      return await response.json()
    } catch (err) {
      let error: Record<string, any>
      if (err instanceof Error) {
        error = { name: err.name, message: err.message, stack: err.stack }
      } else if (err && typeof err === 'object') {
        const message = (err as any).message || (err as any).error?.message || (() => {
          try { return JSON.stringify(err) } catch { return String(err) }
        })()
        error = { ...(err as Record<string, any>), message }
      } else {
        error = { message: String(err) }
      }
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
  if (options?.userId) rq = rq.eq('hunter_id', options.userId)

        const { data: reqs, error } = await rq
        if (error) throw error
            const requests = (reqs as unknown as BountyRequest[]) ?? []
            if (requests.length === 0) return []

        // Ensure we only convert non-null/undefined/non-empty values to strings.
        // Converting `null` to String(null) gives "null" which leads to Postgres
        // `invalid input syntax for type uuid: "null"` when used in `.in()` queries.
        const bountyIds = Array.from(new Set(
          requests
            .map(r => (r as any).bounty_id)
            .filter((id) => id !== null && id !== undefined && id !== '')
            .map((id) => String(id))
        )) as string[]

        const userIds = Array.from(new Set(
          requests
            .map(r => (r as any).hunter_id)
            .filter((id) => id !== null && id !== undefined && id !== '')
            .map((id) => String(id))
        )) as string[]

        // Defensive logging when unexpected values would have been present
        if (requests.some(r => (r as any).bounty_id == null)) {
          logger.warning('Some bounty requests contain null bounty_id values; skipping nulls when fetching related bounties', { count: requests.length })
        }
        if (requests.some(r => (r as any).hunter_id == null)) {
          logger.warning('Some bounty requests contain null hunter_id values; skipping nulls when fetching related profiles', { count: requests.length })
        }

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
          profile: profileMap.get(String((r as any).hunter_id)) as Profile,
        }))
        return result
      }

      const params = new URLSearchParams()
      if (options?.status) params.append("status", options.status)
  if (options?.bountyId) params.append("bounty_id", String(options.bountyId))
  if (options?.userId) params.append("hunter_id", options.userId)

      // Backend returns joined bounty + profile details on the same endpoint
      const url = `${API_BASE_URL}/api/bounty-requests${params.toString() ? `?${params.toString()}` : ''}`
      const response = await fetch(url)
      if (!response.ok) {
        const body = await response.text().catch(() => '<no-body>')
        throw new Error(`Failed to fetch bounty requests (with details): ${response.status} ${response.statusText} — ${body}`)
      }
      return await response.json()
    } catch (err) {
      let error: Record<string, any>
      if (err instanceof Error) {
        error = { name: err.name, message: err.message, stack: err.stack }
      } else if (err && typeof err === 'object') {
        const message = (err as any).message || (err as any).error?.message || (() => {
          try { return JSON.stringify(err) } catch { return String(err) }
        })()
        error = { ...(err as Record<string, any>), message }
      } else {
        error = { message: String(err) }
      }
      logger.error("Error fetching bounty requests with details", { options, error })
      return []
    }
  },

  /**
   * Create a new bounty request
   */
  async create(request: Omit<BountyRequest, "id" | "created_at">): Promise<BountyRequest | null> {
    try {
      // Normalize payload: ensure the canonical column `hunter_id` is present.
      // The DB table uses `hunter_id` (and poster_id), so don't add a `user_id`
      // field which may not exist in the schema.
      const normalizedRequest: any = { ...(request as any) }
      if (!normalizedRequest.hunter_id && normalizedRequest.user_id) {
        normalizedRequest.hunter_id = normalizedRequest.user_id
      }

      // Debug: log normalized payload so we can inspect what is sent to backend/Supabase
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[bountyRequestService.create] normalizedRequest ->', normalizedRequest)
      }

      // Before inserting into Supabase, ensure we don't send a `user_id` column
      if ((normalizedRequest as any).user_id) {
        delete (normalizedRequest as any).user_id
      }

      if (isSupabaseConfigured) {
        // Ensure poster_id is present to satisfy DB constraints. Fetch from bounties table if missing.
        if (!normalizedRequest.poster_id && normalizedRequest.bounty_id) {
          try {
            // Only request poster_id; some DBs do not have legacy user_id column.
            const { data: bountyRow, error: bountyErr } = await supabase
              .from('bounties')
              .select('poster_id')
              .eq('id', String(normalizedRequest.bounty_id))
              .single()

            if (bountyErr) {
              logger.error('Supabase error fetching bounty for poster_id', { bountyId: normalizedRequest.bounty_id, error: (bountyErr as any)?.message || bountyErr })
              throw bountyErr
            }

            normalizedRequest.poster_id = (bountyRow as any)?.poster_id || null
          } catch (fetchErr) {
            const msg = `Failed to resolve poster_id for bounty ${normalizedRequest.bounty_id}`
            logger.error(msg, { bountyId: normalizedRequest.bounty_id, error: (fetchErr as any)?.message || fetchErr })
            throw new Error(msg)
          }
        }

        // Remove legacy/incorrect user_id column before inserting (schema uses hunter_id/poster_id)
        if ((normalizedRequest as any).user_id) delete (normalizedRequest as any).user_id

        const { data, error } = await supabase
          .from('bounty_requests')
          .insert(normalizedRequest)
          .select('*')
          .single()
        if (error) {
          // Log Supabase error details for better diagnostics
          logger.error('Supabase error creating bounty request', { request: normalizedRequest, error: (error as any)?.message || error })
          throw error
        }
        return (data as unknown as BountyRequest) ?? null
      }

      const response = await fetch(`${API_BASE_URL}/api/bounty-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedRequest),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '<no-body>')
        // Log full response details so the client log exposes backend validation messages
        logger.error('Backend rejected bounty request', {
          request: normalizedRequest,
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        })
        throw new Error(`Failed to create bounty request: ${response.status} ${response.statusText} — ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      // Preserve useful error information even when upstream libraries throw plain objects
      let errorMessage = 'Unknown error'
      if (err instanceof Error) {
        errorMessage = err.message
      } else if (err && typeof err === 'object') {
        // Try common fields
        if ('message' in err && typeof (err as any).message === 'string') {
          errorMessage = (err as any).message
        } else {
          try {
            errorMessage = JSON.stringify(err)
          } catch (e) {
            errorMessage = String(err)
          }
        }
      } else if (typeof err === 'string') {
        errorMessage = err
      }

      logger.error('Error creating bounty request', { request: (request as any), error: errorMessage })
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
