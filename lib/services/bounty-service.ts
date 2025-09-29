import type { Bounty } from "lib/services/database.types"
import { logger } from "lib/utils/error-logger"
import { API_CONFIG } from "lib/config/app-config"

export const bountyService = {
  /**
   * Get a bounty by ID
   */
  async getById(id: number): Promise<Bounty | null> {
    try {
      const API_URL = `${API_CONFIG.baseUrl}/api/bounties/${id}`
      const response = await fetch(API_URL, {
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
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
  async getAll(options?: { status?: string; userId?: string }): Promise<Bounty[]> {
    try {
      const API_URL = `${API_CONFIG.baseUrl}/api/bounties`
      const params = new URLSearchParams()

       if (options?.status) params.append("status", options.status)
    const response = await fetch(API_URL + "?" + params.toString())
    if (!response.ok) {
      throw new Error(`Failed to fetch bounties: ${response.statusText}`)
    }
    return await response.json()
  } catch (err) {
    const error = err instanceof Error ? err : new Error("Unknown error fetching bounties")
    logger.error("Error fetching bounties", { options, error })
    return [] // Add a return statement here
  }
},

  /**
   * Create a new bounty
   */
  async create(bounty: Omit<Bounty, "id" | "created_at">): Promise<Bounty | null> {
    try {
      const API_URL = `${API_CONFIG.baseUrl}/api/bounties`
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ANNOTATION: Add authentication headers if required.
          // 'Authorization': `Bearer ${your_auth_token}`
        },
        body: JSON.stringify(bounty),
      })

      if (!response.ok) {
        throw new Error(`Failed to create bounty: ${await response.text()}`)
      }

      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error creating bounty", { bounty, error })
      return null
    }
  },

  /**
   * Update a bounty
   */
  async update(id: number, updates: Partial<Omit<Bounty, "id" | "created_at">>): Promise<Bounty | null> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/bounties/${id}`
      const response = await fetch(API_URL, {
        method: "PATCH", // or 'PUT'
        headers: {
          "Content-Type": "application/json",
          // ANNOTATION: Add authentication headers if required.
          // 'Authorization': `Bearer ${your_auth_token}`
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        throw new Error(`Failed to update bounty: ${await response.text()}`)
      }

      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error updating bounty", { id, updates, error })
      return null
    }
  },

  /**
   * Delete a bounty
   */
  async delete(id: number): Promise<boolean> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/bounties/${id}`
      const response = await fetch(API_URL, {
        method: "DELETE",
        // ANNOTATION: Add authentication headers if required.
        // 'Authorization': `Bearer ${your_auth_token}`
      })

      if (!response.ok) {
        throw new Error(`Failed to delete bounty: ${await response.text()}`)
      }

      return true
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error deleting bounty", { id, error })
      return false
    }
  },

  /**
   * Update a bounty's status
   */
  async updateStatus(id: number, status: "open" | "in_progress" | "completed" | "archived"): Promise<Bounty | null> {
    // This can be a specific endpoint or part of the general update method.
    // Reusing the `update` method is a common pattern.
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
