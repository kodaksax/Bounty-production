import type { Skill } from "lib/services/database.types";
import { logger } from "lib/utils/error-logger";

export const skillService = {
  /**
   * Get a skill by ID
   */
  async getById(id: number): Promise<{ skill: Skill | null; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/skills/${id}`
      const response = await fetch(API_URL, {
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        if (response.status === 404) {
          return { skill: null, error: new Error("Skill not found") }
        }
        throw new Error(`Failed to fetch skill: ${response.statusText}`)
      }

      const skill = await response.json()
      return { skill, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching skill")
      logger.error(error.message, { id, error })
      return { skill: null, error }
    }
  },

  /**
   * Get all skills
   */
  async getAll(): Promise<{ skills: Skill[]; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = "https://your-hostinger-domain.com/api/skills"
      const response = await fetch(API_URL, {
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch skills: ${response.statusText}`)
      }

      const skills = await response.json()
      return { skills, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching skills")
      logger.error(error.message, { error })
      return { skills: [], error }
    }
  },

  /**
   * Create a new skill
   */
  async create(skillData: Omit<Skill, "id" | "created_at">): Promise<{ skill: Skill | null; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = "https://your-hostinger-domain.com/api/skills"
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ANNOTATION: Add authentication headers if required.
          // 'Authorization': `Bearer ${your_auth_token}`
        },
        body: JSON.stringify(skillData),
      })

      if (!response.ok) {
        throw new Error(`Failed to create skill: ${response.statusText}`)
      }

      const newSkill = await response.json()
      return { skill: newSkill, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error creating skill")
      logger.error(error.message, { skillData, error })
      return { skill: null, error }
    }
  },

  /**
   * Update a skill
   */
  async update(
    id: number,
    updates: Partial<Omit<Skill, "id" | "created_at">>,
  ): Promise<{ skill: Skill | null; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/skills/${id}`
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
        throw new Error(`Failed to update skill: ${response.statusText}`)
      }

      const updatedSkill = await response.json()
      return { skill: updatedSkill, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error updating skill")
      logger.error(error.message, { id, updates, error })
      return { skill: null, error }
    }
  },

  /**
   * Delete a skill
   */
  async delete(id: number): Promise<{ success: boolean; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/skills/${id}`
      const response = await fetch(API_URL, {
        method: "DELETE",
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        throw new Error(`Failed to delete skill: ${response.statusText}`)
      }

      return { success: true, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error deleting skill")
      logger.error(error.message, { id, error })
      return { success: false, error }
    }
  },

  /**
   * Get skills by user ID
   */
  async getByUserId(userId: string): Promise<{ skills: Skill[]; error: Error | null }> {
    // This method can call getAll if your API supports filtering,
    // or it can have its own endpoint.
    // ANNOTATION: Replace with your actual Hostinger API endpoint.
    const API_URL = `https://your-hostinger-domain.com/api/skills?userId=${userId}`
    // Or `https://your-hostinger-domain.com/api/users/${userId}/skills`
    try {
      const response = await fetch(API_URL, {
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch skills for user: ${response.statusText}`)
      }

      const skills = await response.json()
      return { skills, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error fetching user skills")
      logger.error(error.message, { userId, error })
      return { skills: [], error }
    }
  },

  /**
   * Create multiple skills for a user
   */
  async createMultiple(
    userId: string,
    skills: Array<{ icon: string; text: string }>,
  ): Promise<{ skills: Skill[]; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint for bulk creation.
      const API_URL = "https://your-hostinger-domain.com/api/skills/bulk"
      const skillsWithUserId = skills.map((skill) => ({ ...skill, user_id: userId }))

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ANNOTATION: Add authentication headers if required.
          // 'Authorization': `Bearer ${your_auth_token}`
        },
        body: JSON.stringify(skillsWithUserId),
      })

      if (!response.ok) {
        throw new Error(`Failed to create multiple skills: ${response.statusText}`)
      }

      const newSkills = await response.json()
      return { skills: newSkills, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error creating multiple skills")
      logger.error(error.message, { userId, error })
      return { skills: [], error }
    }
  },

  /**
   * Delete all skills for a user
   */
  async deleteByUserId(userId: string): Promise<{ success: boolean; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint for bulk deletion.
      const API_URL = `https://your-hostinger-domain.com/api/skills?userId=${userId}`
      const response = await fetch(API_URL, {
        method: "DELETE",
        // ANNOTATION: Add authentication headers if required.
        // headers: { 'Authorization': `Bearer ${your_auth_token}` }
      })

      if (!response.ok) {
        throw new Error(`Failed to delete skills for user: ${response.statusText}`)
      }

      return { success: true, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error deleting user skills")
      logger.error(error.message, { userId, error })
      return { success: false, error }
    }
  },
}
