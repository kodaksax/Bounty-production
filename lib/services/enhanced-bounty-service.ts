import type { Bounty } from "lib/services/database.types";
import { logger } from "lib/utils/error-logger";
import { z } from "zod";
import AsyncStorage from '@react-native-async-storage/async-storage';


// ANNOTATION: This schema should be defined in a shared location, e.g., 'lib/validation/bounty-schema.ts'
import { bountySchema } from "components/bounty/bounty-form"; // Assuming it's exported from here
export type BountyFormValues = z.infer<typeof bountySchema>

/**
 * Enhanced Bounty Service with validation, error handling, and offline support
 */
export const enhancedBountyService = {
  /**
   * Get a bounty by ID with improved error handling
   */
  async getById(id: number): Promise<{ bounty: Bounty | null; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/bounties/${id}`
      const response = await fetch(API_URL, {
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        if (response.status === 404) {
          return { bounty: null, error: new Error("Bounty not found") }
        }
        throw new Error(`Failed to fetch bounty: ${response.statusText}`)
      }
      return { bounty: null, error: null } // IGNORE
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching bounty")
      logger.error("Error fetching bounty by ID", { id, error })
      return { bounty: null, error }
    }
  },

  /**
   * Get all bounties with filtering, pagination, and sorting
   * Includes fallback to local cache when offline
   */
  async getAll(options?: {
    status?: string
    userId?: string
    search?: string
    page?: number
    limit?: number
    orderBy?: string
    orderDirection?: "asc" | "desc"
  }): Promise<{ bounties: Bounty[]; count: number | null; error: Error | null }> {
    try {
      const {
        status,
        userId,
        search,
        page = 1,
        limit = 20,
        orderBy = "created_at",
        orderDirection = "desc",
      } = options || {}

      // Try to get data from local storage first (for offline support)
      let cachedData: Bounty[] | null = null
try {
  const cacheKey = `bounties_cache_${JSON.stringify(options)}`
  const cachedString = await AsyncStorage.getItem(cacheKey);
  if (cachedString !== null) {
    try {
      // You can parse and use cachedString here if needed
      const cached = JSON.parse(cachedString);
      cachedData = cached.data;
    } catch (error) {
      // Handle JSON parse error
    }
  }
} catch (e) {
  // Ignore AsyncStorage errors
}

      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = "https://your-hostinger-domain.com/api/bounties"
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        orderBy,
        orderDirection,
      })

      if (status) params.append("status", status)
      if (userId) params.append("userId", userId)
      if (search) params.append("search", search)

      const response = await fetch(`${API_URL}?${params.toString()}`, {
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        const errorText = await response.text()
        // If we have cached data and there's a network error, use the cache
        if (cachedData && (errorText.includes("Failed to fetch") || errorText.includes("network"))) {
          logger.warning("Using cached data due to network error", { options })
          return { bounties: cachedData, count: (cachedData as Bounty[] | null)?.length ?? null, error: null }
        }
        throw new Error(`Failed to fetch bounties: ${errorText}`)
      }

      // ANNOTATION: Assuming your API returns an object like { bounties: [], count: 0 }
      const { bounties, count } = await response.json()

      // Update cache
      try {
        const cacheKey = `bounties_cache_${JSON.stringify(options)}`
        AsyncStorage.setItem(
          cacheKey,
          JSON.stringify({
            data: bounties,
            timestamp: Date.now(),
          }),
        )
      } catch (e) {
        // Ignore AsyncStorage errors
      }

      return { bounties: bounties || [], count, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error fetching bounties", { options, error })

      // Try to get data from local storage as fallback
      try {
        const cacheKey = `bounties_cache_${JSON.stringify(options)}`
        const cachedString = await AsyncStorage.getItem(cacheKey);
        
        if (cachedString) {
          const cached = JSON.parse(cachedString)
          logger.info("Using cached data as fallback", { options })
          return { bounties: cached.data, count: cached.data.length, error: null }
        }
      } catch (e) {
        // Ignore AsyncStorage errors
      }

      return { bounties: [], count: null, error }
    }
  },

  /**
   * Create a new bounty with validation
   */
  async create(
    bountyData: BountyFormValues & { user_id: string },
  ): Promise<{ bounty: Bounty | null; error: Error | null }> {
    try {
      // Validate bounty data
      const validatedData = bountySchema.parse(bountyData)

      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = "https://your-hostinger-domain.com/api/bounties"
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ANNOTATION: Add authentication headers if required.
          // 'Authorization': `Bearer ${your_auth_token}`
        },
        body: JSON.stringify({ ...validatedData, user_id: bountyData.user_id }),
      })

      if (!response.ok) {
        throw new Error(`Failed to create bounty: ${await response.text()}`)
      }

      const newBounty = await response.json()

      // Update local cache
      try {
        this.updateLocalCache(newBounty)
      } catch (e) {
        // Ignore cache errors
      }

      return { bounty: newBounty, error: null }
    } catch (err: any) {
      // Special handling for validation errors
      if (err.name == "ZodError") {
        return { bounty: null, error: new Error(`Validation error: ${err.errors[0].message}`) }
      }

      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error creating bounty", { bountyData, error })
      return { bounty: null, error }
    }
  },

  /**
   * Update a bounty with validation
   */
  async update(
    id: number,
    updates: Partial<BountyFormValues>,
  ): Promise<{ bounty: Bounty | null; error: Error | null }> {
    try {
      // Partial validation of updates
      const validatedData = bountySchema.partial().parse(updates)

      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/bounties/${id}`
      const response = await fetch(API_URL, {
        method: "PATCH", // or 'PUT'
        headers: {
          "Content-Type": "application/json",
          // ANNOTATION: Add authentication headers if required.
          // 'Authorization': `Bearer ${your_auth_token}`
        },
        body: JSON.stringify(validatedData),
      })

      if (!response.ok) {
        throw new Error(`Failed to update bounty: ${await response.text()}`)
      }

      const updatedBounty = await response.json()

      // Update local cache
      try {
        this.updateLocalCache(updatedBounty)
      } catch (e) {
        // Ignore cache errors
      }

      return { bounty: updatedBounty, error: null }
    } catch (err: any) {
      // Special handling for validation errors
      if (err.name === "ZodError") {
        return { bounty: null, error: new Error(`Validation error: ${err.errors[0].message}`) }
      }

      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error updating bounty", { id, updates, error })
      return { bounty: null, error }
    }
  },

  /**
   * Helper method to update local cache
   */
 async updateLocalCache(bounty: Bounty): Promise<void> {
    try {
      // Update user's bounties cache
      const userCacheKey = `bounties_cache_${JSON.stringify({ userId: bounty.user_id })}`
      const userCachedString = await AsyncStorage.getItem(userCacheKey)

      if (userCachedString) {
        const userCached = JSON.parse(userCachedString)
        const bounties = userCached.data || []

        // Replace or add the bounty
        const index = bounties.findIndex((b: Bounty) => b.id === bounty.id)
        if (index >= 0) {
          bounties[index] = bounty
        } else {
          bounties.unshift(bounty)
        }

        AsyncStorage.setItem(
          userCacheKey,
          JSON.stringify({
            data: bounties,
            timestamp: Date.now(),
          }),
        )
      }

      // Update all bounties cache
      const allCacheKey = `bounties_cache_${JSON.stringify({})}`
      const allCachedString = await AsyncStorage.getItem(allCacheKey)

      if (allCachedString) {
        const allCached = JSON.parse(allCachedString)
        const bounties = allCached.data || []

        // Replace or add the bounty
        const index = bounties.findIndex((b: Bounty) => b.id === bounty.id)
        if (index >= 0) {
          bounties[index] = bounty
        } else {
          bounties.unshift(bounty)
        }

        AsyncStorage.setItem(
          allCacheKey,
          JSON.stringify({
            data: bounties,
            timestamp: Date.now(),
          }),
        )
      }
    } catch (e) {
      // Ignore AsyncStorage errors
    }
  },

  /**
   * Delete a bounty
   */
  async delete(id: number): Promise<{ success: boolean; error: Error | null }> {
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

      // Update local caches to remove this bounty
      try {
        const cacheKeys = Object.keys(AsyncStorage).filter((key) => key.startsWith("bounties_cache_"))

        for (const key of cacheKeys) {
          const cachedString = await AsyncStorage.getItem(key)
          if (cachedString) {
            const cached = JSON.parse(cachedString)
            const bounties = cached.data || []

            // Remove the bounty from cache
            const filteredBounties = bounties.filter((b: Bounty) => b.id !== id)

            AsyncStorage.setItem(
              key,
              JSON.stringify({
                data: filteredBounties,
                timestamp: Date.now(),
              }),
            )
          }
        }
      } catch (e) {
        // Ignore AsyncStorage errors
      }

      return { success: true, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error deleting bounty", { id, error })
      return { success: false, error }
    }
  },
}
