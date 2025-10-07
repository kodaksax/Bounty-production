import type { Bounty } from "lib/services/database.types";
import { isSupabaseConfigured, supabase } from 'lib/supabase';
import { logger } from "lib/utils/error-logger";

// API Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

// Simple once-per-key logger to avoid spamming console when backend is offline
const emitted: Record<string, boolean> = {}
function logOnce(key: string, level: 'error' | 'warn', message: string, meta?: any) {
  if (emitted[key]) return
  emitted[key] = true
  if (level === 'error') {
    logger.error(message, meta)
  } else {
    if (typeof (logger as any).warning === 'function') {
      ;(logger as any).warning(message, meta)
    } else {
      logger.error(message, meta)
    }
  }
}

export const bountyService = {
  /**
   * Get a bounty by ID
   */
  async getById(id: number): Promise<Bounty | null> {
    try {
      // Prefer Supabase when configured
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounties')
          .select('*')
          .eq('id', id)
          .single()

        if (error) throw error
        return (data as unknown as Bounty) ?? null
      }

      const API_URL = `${API_BASE_URL}/api/bounties/${id}`
      const response = await fetch(API_URL, {
        headers: {
          'Content-Type': 'application/json',
        }
      })

      if (!response.ok) {
        if (response.status === 404) {
          logger.warning("Bounty not found", { id })
          return null
        }
        throw new Error(`Failed to fetch bounty: ${response.statusText}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching bounty")
      logger.error("Error fetching bounty by ID", { id, error })
      return null
    }
  },

  /**
   * Get all bounties
   */
  async getAll(options?: {
    status?: string;
    userId?: string;
    workType?: 'online' | 'in_person';
    limit?: number;
    offset?: number;
    includeArchived?: boolean;
  }): Promise<Bounty[]> {
    try {
      // Prefer Supabase when configured
      if (isSupabaseConfigured) {
        let query = supabase
          .from('bounties')
          .select('*')
          .order('created_at', { ascending: false })

        if (options?.status) query = query.eq('status', options.status)
        if (options?.userId) query = query.eq('user_id', options.userId)
        if (options?.workType) query = query.eq('work_type', options.workType)
        if (!options?.includeArchived) query = query.neq('status', 'archived')

        const limit = options?.limit ?? 20
        const offset = options?.offset ?? 0
        query = query.range(offset, offset + limit - 1)

        const { data, error } = await query
        if (error) throw error
        return (data as unknown as Bounty[]) ?? []
      }

      const API_URL = `${API_BASE_URL}/api/bounties`
      const params = new URLSearchParams()

      if (options?.status) params.append("status", options.status)
      if (options?.userId) params.append("user_id", options.userId)
      if (options?.workType) params.append('work_type', options.workType)
      if (options?.limit != null) params.append('limit', String(options.limit))
      if (options?.offset != null) params.append('offset', String(options.offset))
      // archived filtering handled client-side if API doesn't support it
      
      const response = await fetch(`${API_URL}?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch bounties: ${response.statusText}`)
      }
      const json = await response.json()
      let list = Array.isArray(json) ? json as Bounty[] : []
      if (!options?.includeArchived) list = list.filter(b => b.status !== 'archived')
      if (options?.limit != null || options?.offset != null) {
        const start = options?.offset ?? 0
        const end = options?.limit != null ? start + options.limit : undefined
        list = list.slice(start, end)
      }
      return list
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching bounties")
      // Heuristics for network issues
      const isNetworkError = error.message.includes('Network') || error.message.includes('fetch') || !(error as any).status
      logOnce(
        'bounties:getAll',
        'error',
        'Error fetching bounties (showing once until reload)',
        {
          options,
          error: { message: error.message, stack: error.stack },
          apiBase: API_BASE_URL,
            hint: isNetworkError ? 'Check that the API server is running and device can reach the host (if on physical device, replace localhost with your machine LAN IP).' : undefined,
        }
      )
      return []
    }
  },

  /**
   * Create a new bounty
   */
  async create(bounty: Omit<Bounty, "id" | "created_at">): Promise<Bounty | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounties')
          .insert(bounty as any)
          .select('*')
          .single()

        if (error) throw error
        return (data as unknown as Bounty) ?? null
      }

      const API_URL = `${API_BASE_URL}/api/bounties`
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bounty),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create bounty: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logOnce('bounties:create', 'error', 'Error creating bounty (showing once until reload)', { bounty, error })
      return null
    }
  },

  /**
   * Update a bounty
   */
  async update(id: number, updates: Partial<Omit<Bounty, "id" | "created_at">>): Promise<Bounty | null> {
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from('bounties')
          .update(updates as any)
          .eq('id', id)
          .select('*')
          .single()

        if (error) throw error
        return (data as unknown as Bounty) ?? null
      }

      const API_URL = `${API_BASE_URL}/api/bounties/${id}`
      const response = await fetch(API_URL, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to update bounty: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logOnce('bounties:update', 'error', 'Error updating bounty (showing once until reload)', { id, updates, error })
      return null
    }
  },

  /**
   * Delete a bounty
   */
  async delete(id: number): Promise<boolean> {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('bounties')
          .delete()
          .eq('id', id)

        if (error) throw error
        return true
      }

      const API_URL = `${API_BASE_URL}/api/bounties/${id}`
      const response = await fetch(API_URL, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to delete bounty: ${errorText}`)
      }

      return true
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logOnce('bounties:delete', 'error', 'Error deleting bounty (showing once until reload)', { id, error })
      return false
    }
  },

  /**
   * Update a bounty's status
   */
  async updateStatus(id: number, status: "open" | "in_progress" | "completed" | "archived"): Promise<Bounty | null> {
    return this.update(id, { status })
  },

  /**
   * Get bounties by user ID
   */
  async getByUserId(userId: string): Promise<Bounty[]> {
    return this.getAll({ userId })
  },

  /**
   * Get open bounties
   */
  async getOpenBounties(): Promise<Bounty[]> {
    return this.getAll({ status: "open" })
  },
  
  /**
   * Get bounties by work type (online or in_person)
   */
  async getByWorkType(workType: 'online' | 'in_person'): Promise<Bounty[]> {
    return this.getAll({ workType })
  },

  /**
   * Get in-progress bounties
   */
  async getInProgressBounties(): Promise<Bounty[]> {
    return this.getAll({ status: "in_progress" })
  },

  /**
   * Get completed bounties
   */
  async getCompletedBounties(): Promise<Bounty[]> {
    return this.getAll({ status: "completed" })
  },

  /**
   * Get archived bounties
   */
  async getArchivedBounties(): Promise<Bounty[]> {
    return this.getAll({ status: "archived" })
  },
}
