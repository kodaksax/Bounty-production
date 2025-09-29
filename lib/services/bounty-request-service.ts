import type { Bounty, BountyRequest, Profile } from "lib/services/database.types"
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
  async getById(id: number): Promise<BountyRequest | null> {
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
  async getAll(options?: { status?: string; bountyId?: number; userId?: string }): Promise<BountyRequest[]> {
    try {
      const params = new URLSearchParams()
      if (options?.status) params.append("status", options.status)
      if (options?.bountyId) params.append("bounty_id", String(options.bountyId))
      if (options?.userId) params.append("user_id", options.userId)

      const response = await fetch(`${API_BASE_URL}/api/bounty-requests?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch bounty requests: ${response.statusText}`)
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
  async getAllWithDetails(options?: { status?: string; bountyId?: number; userId?: string }): Promise<BountyRequestWithDetails[]> {
    try {
      const params = new URLSearchParams()
      if (options?.status) params.append("status", options.status)
      if (options?.bountyId) params.append("bounty_id", String(options.bountyId))
      if (options?.userId) params.append("user_id", options.userId)

      const response = await fetch(`${API_BASE_URL}/api/bounty-requests?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch bounty requests: ${response.statusText}`)
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
  async update(id: number, updates: Partial<Omit<BountyRequest, "id" | "created_at">>): Promise<BountyRequest | null> {
    try {
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
  async delete(id: number): Promise<boolean> {
    try {
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
  async updateStatus(id: number, status: "pending" | "accepted" | "rejected"): Promise<BountyRequest | null> {
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
  async getByBountyId(bountyId: number): Promise<BountyRequest[]> {
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
  async acceptRequest(requestId: number): Promise<BountyRequest | null> {
    return this.updateStatus(requestId, "accepted")
  },

  /**
   * Reject a bounty request
   */
  async rejectRequest(requestId: number): Promise<BountyRequest | null> {
    return this.updateStatus(requestId, "rejected")
  },
}
