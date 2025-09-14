import type { Profile } from "lib/services/database.types";
import { logger } from "lib/utils/error-logger";

export const profileService = {
  /**
   * Get a profile by ID
   */
  async getById(id: string): Promise<{ profile: Profile | null; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/profiles/${id}`
      const response = await fetch(API_URL, {
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        if (response.status === 404) {
          return { profile: null, error: new Error("Profile not found") }
        }
        throw new Error(`Failed to fetch profile: ${response.statusText}`)
      }

      const profile = await response.json()
      return { profile, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching profile")
      logger.error(error.message, { id, error })
      return { profile: null, error }
    }
  },

  /**
   * Get all profiles
   */
  async getAll(): Promise<{ profiles: Profile[]; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = "https://your-hostinger-domain.com/api/profiles"
      const response = await fetch(API_URL, {
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch profiles: ${response.statusText}`)
      }

      const profiles = await response.json()
      return { profiles, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching profiles")
      logger.error(error.message, { error })
      return { profiles: [], error }
    }
  },

  /**
   * Create a new profile
   */
  async create(profileData: Omit<Profile, "id" | "created_at">): Promise<{ profile: Profile | null; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = "https://your-hostinger-domain.com/api/profiles"
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ANNOTATION: Add authentication headers if required.
          // 'Authorization': `Bearer ${your_auth_token}`
        },
        body: JSON.stringify(profileData),
      })

      if (!response.ok) {
        throw new Error(`Failed to create profile: ${response.statusText}`)
      }

      const newProfile = await response.json()
      return { profile: newProfile, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error creating profile")
      logger.error(error.message, { profileData, error })
      return { profile: null, error }
    }
  },

  /**
   * Update a profile
   */
  async update(
    id: string,
    updates: Partial<Omit<Profile, "id" | "created_at">>,
  ): Promise<{ profile: Profile | null; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/profiles/${id}`
      const response = await fetch(API_URL, {
        method: "PATCH", // Or 'PUT'
        headers: {
          "Content-Type": "application/json",
          // ANNOTATION: Add authentication headers if required.
          // 'Authorization': `Bearer ${your_auth_token}`
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        throw new Error(`Failed to update profile: ${response.statusText}`)
      }

      const updatedProfile = await response.json()
      return { profile: updatedProfile, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error updating profile")
      logger.error(error.message, { id, updates, error })
      return { profile: null, error }
    }
  },

  /**
   * Delete a profile
   */
  async delete(id: string): Promise<{ success: boolean; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/profiles/${id}`
      const response = await fetch(API_URL, {
        method: "DELETE",
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        throw new Error(`Failed to delete profile: ${response.statusText}`)
      }

      return { success: true, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error deleting profile")
      logger.error(error.message, { id, error })
      return { success: false, error }
    }
  },

  /**
   * Update a profile's balance
   */
  async updateBalance(id: string, amount: number): Promise<Profile | null> {
    // This is a specific version of the update method.
    // Your backend could have a dedicated endpoint like `/api/profiles/:id/balance`
    // or handle it through the general update endpoint.
    const { profile, error } = await this.update(id, { balance: amount })
    if (error) {
      logger.error("Error updating profile balance", { id, amount, error })
    }
    return profile
  },
}
