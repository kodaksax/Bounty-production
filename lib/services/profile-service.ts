import { API_BASE_URL } from 'lib/config/api';
import type { Profile } from "lib/services/database.types";
import { logger } from "lib/utils/error-logger";

export const profileService = {
  /**
   * Get a profile by ID
   */
  async getById(id: string): Promise<Profile | null> {
    try {
      const API_URL = `${API_BASE_URL}/api/profiles/${id}`
      const response = await fetch(API_URL, {
        headers: {
          'Content-Type': 'application/json',
        }
      })

      if (!response.ok) {
        if (response.status === 404) {
          logger.warning("Profile not found", { id })
          return null
        }
        throw new Error(`Failed to fetch profile: ${response.statusText}`)
      }

      const profile = await response.json()
      return profile
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching profile")
      logger.error("Error fetching profile by ID", { id, error })
      return null
    }
  },

  /**
   * Get all profiles
   */
  async getAll(): Promise<Profile[]> {
    try {
      const API_URL = `${API_BASE_URL}/api/profiles`
      const response = await fetch(API_URL, {
        headers: {
          'Content-Type': 'application/json',
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch profiles: ${response.statusText}`)
      }

      const profiles = await response.json()
      return profiles
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching profiles")
      logger.error("Error fetching all profiles", { error })
      return []
    }
  },

  /**
   * Create a new profile
   */
  async create(profileData: Omit<Profile, "id" | "created_at">): Promise<Profile | null> {
    try {
      const API_URL = `${API_BASE_URL}/api/profiles`
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(profileData),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create profile: ${errorText}`)
      }

      const newProfile = await response.json()
      return newProfile
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error creating profile")
      logger.error("Error creating profile", { profileData, error })
      return null
    }
  },

  /**
   * Update a profile
   */
  async update(
    id: string,
    updates: Partial<Omit<Profile, "id" | "created_at">>,
  ): Promise<Profile | null> {
    try {
      const API_URL = `${API_BASE_URL}/api/profiles/${id}`
      const response = await fetch(API_URL, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to update profile: ${errorText}`)
      }

      const updatedProfile = await response.json()
      return updatedProfile
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error updating profile")
      logger.error("Error updating profile", { id, updates, error })
      return null
    }
  },

  /**
   * Delete a profile
   */
  async delete(id: string): Promise<boolean> {
    try {
      const API_URL = `${API_BASE_URL}/api/profiles/${id}`
      const response = await fetch(API_URL, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to delete profile: ${errorText}`)
      }

      return true
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error deleting profile")
      logger.error("Error deleting profile", { id, error })
      return false
    }
  },

  /**
   * Update a profile's balance
   */
  async updateBalance(id: string, amount: number): Promise<Profile | null> {
    return this.update(id, { balance: amount })
  },
}
