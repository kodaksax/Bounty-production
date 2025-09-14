import type { Bounty, BountyRequest, Profile } from "lib/services/database.types"
import { logger } from "lib/utils/error-logger"

export type BountyRequestWithDetails = BountyRequest & {
  bounty: Bounty
  profile: Profile
}

// ANNOTATION: Define the base URL for your Hostinger API in a central configuration file.
const API_BASE_URL = "https://your-hostinger-domain.com/api"



export const bountyRequestService = {
  /**
   * Get a bounty request by ID
   */
  async getById(id: number): Promise<BountyRequest | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/bounty-requests/${id}`)
      if (!response.ok) {
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
   * Get a bounty request with details by ID
   */
  async getByIdWithDetails(id: number): Promise<BountyRequestWithDetails | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/bounty-requests/${id}?_embed=bounty,profile`)
      if (!response.ok) {
        throw new Error(`Failed to fetch bounty request with details: ${response.statusText}`)
      }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error fetching bounty request with details", { id, error })
      return null
    }
  },

  /**
   * Get all bounty requests
   */
  async getAll(options?: { status?: string; bountyId?: number; userId?: string }): Promise<BountyRequest[]> {
    try {
      const params = new URLSearchParams()
      if (options?.status) params.append("status", options.status)
      if (options?.bountyId) params.append("bountyId", String(options.bountyId))
      if (options?.userId) params.append("userId", options.userId)
      params.append("orderBy", "created_at")
      params.append("orderDirection", "desc")

      const response = await fetch(`${API_BASE_URL}/bounty-requests?${params.toString()}`)
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
   * Get all bounty requests with details
   */
  async getAllWithDetails(options?: { status?: string; bountyId?: number; userId?: string }): Promise<
    BountyRequestWithDetails[]
  > {
    try {
      const params = new URLSearchParams()
      // ANNOTATION: Your API needs to support embedding related data.
      params.append("_embed", "bounty,profile")
      if (options?.status) params.append("status", options.status)
      if (options?.bountyId) params.append("bountyId", String(options.bountyId))
      if (options?.userId) params.append("userId", options.userId)
      params.append("orderBy", "created_at")
      params.append("orderDirection", "desc")

      const response = await fetch(`${API_BASE_URL}/bounty-requests?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch bounty requests with details: ${response.statusText}`)
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
      const response = await fetch(`${API_BASE_URL}/bounty-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      })
      if (!response.ok) {
        throw new Error(`Failed to create bounty request: ${await response.text()}`)
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
      const response = await fetch(`${API_BASE_URL}/bounty-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (!response.ok) {
        throw new Error(`Failed to update bounty request: ${await response.text()}`)
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
      const response = await fetch(`${API_BASE_URL}/bounty-requests/${id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        throw new Error(`Failed to delete bounty request: ${await response.text()}`)
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
   * Accept a bounty request and update the bounty status
   */
  async acceptRequest(requestId: number): Promise<{ request: BountyRequest | null; bounty: Bounty | null }> {
    try {
      // ANNOTATION: This should be a single atomic API call on your backend
      // to ensure both the request and bounty are updated together in a transaction.
      const response = await fetch(`${API_BASE_URL}/bounty-requests/${requestId}/accept`, {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error(`Failed to accept bounty request: ${await response.text()}`)
      }

      // ANNOTATION: Assuming the API returns an object like { request: {...}, bounty: {...} }
      return await response.json()
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error accepting bounty request", { requestId, error })
      return { request: null, bounty: null }
    }
  },

  /**
   * Reject a bounty request
   */
  async rejectRequest(requestId: number): Promise<BountyRequest | null> {
    return this.updateStatus(requestId, "rejected")
  },
}
