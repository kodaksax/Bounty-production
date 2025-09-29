import type { Bounty } from "lib/services/database.types"
import { logger } from "lib/utils/error-logger"

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
  async getAll(options?: { status?: string; userId?: string; workType?: 'online' | 'in_person' }): Promise<Bounty[]> {
    try {
      const API_URL = `${API_BASE_URL}/api/bounties`
      const params = new URLSearchParams()

      if (options?.status) params.append("status", options.status)
      if (options?.userId) params.append("user_id", options.userId)
      if (options?.workType) params.append('work_type', options.workType)
      
      const response = await fetch(`${API_URL}?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch bounties: ${response.statusText}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching bounties")
      logOnce('bounties:getAll', 'error', 'Error fetching bounties (showing once until reload)', { options, error })
      return []
    }
  },

  /**
   * Create a new bounty
   */
  async create(bounty: Omit<Bounty, "id" | "created_at">): Promise<Bounty | null> {
    try {
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
