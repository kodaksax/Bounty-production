import { bountyRequestService } from "lib/services/bounty-request-service"
import { bountyService } from "lib/services/bounty-service"
import { profileService } from "lib/services/profile-service"

// API Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

// Define Profile type here for now
export type Profile = {
  id: string;
  username: string;
  email: string;
  balance: number;
  avatar_url?: string;
  about?: string;
  phone?: string;
  created_at?: string;
  updated_at?: string;
}

// Define Bounty type here for now
export type Bounty = {
  id: number;
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  user_id: string;
  location?: string;
  created_at?: string;
  status?: string;
  distance?: number;
  timeline?: string;
  skills_required?: string;
  work_type?: 'online' | 'in_person';
  is_time_sensitive?: boolean;
  deadline?: string;
  attachments_json?: string;
}

// Current user ID (in a real app, this would come from authentication)
export const CURRENT_USER_ID = "00000000-0000-0000-0000-000000000001"

/**
 * Calculate distance (mock function - in a real app, this would use geolocation)
 */
export const calculateDistance = (location: string): number => {
  // Simple mock distance calculation
  return Math.floor(Math.random() * 20) + 1
}

/**
 * Format timestamp to relative time
 */
export const formatTimeAgo = (timestamp: string): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))

  if (diffHrs < 1) return "Just now"
  if (diffHrs < 24) return `${diffHrs}h AGO`
  return `${Math.floor(diffHrs / 24)}d AGO`
}

// Get the current user profile
export const getCurrentUserProfile = async (): Promise<Profile | null> => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/profile`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const profile = await res.json();
    return profile;
  } catch (e) {
    console.error('Error fetching current user profile:', e);
    return null;
  }
}

// Get the current user ID
export const getCurrentUserId = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/user-id`);
    if (!res.ok) return null;
    const userId = await res.text();
    return userId;
  } catch (e) {
    console.error('Error fetching current user ID:', e);
    return CURRENT_USER_ID; // fallback to default
  }
}

/**
 * Create a new bounty with validation
 */
export const createBountyWithValidationUtil = async (
  bountyData: Omit<Bounty, "id" | "created_at" | "status">,
): Promise<{ bounty: Bounty | null; error: string | null }> => {
  // Validate required fields
  if (!bountyData.title.trim()) {
    return { bounty: null, error: "Title is required" }
  }

  if (!bountyData.description.trim()) {
    return { bounty: null, error: "Description is required" }
  }

  if (!bountyData.is_for_honor && bountyData.amount <= 0) {
    return { bounty: null, error: 'Please set a valid bounty amount or mark as "For Honor"' }
  }

  try {
    // Check if the user exists first
    let user = await profileService.getById(bountyData.user_id)

    // If user doesn't exist, create a default profile
    if (!user) {
      console.log("User doesn't exist, creating default profile...")
      const defaultProfile = {
        id: bountyData.user_id,
        username: "@Jon_Doe",
        avatar_url: "/placeholder.svg?height=40&width=40",
        about: "Russian opportunist",
        phone: "+998 90 943 32 00",
        balance: 40.0,
        email: "test@example.com"
      }

      try {
        user = await profileService.create(defaultProfile)
        if (!user) {
          console.warn("Failed to create default profile, continuing anyway...")
        }
      } catch (err) {
        console.warn("Error creating default profile:", err)
        // Continue with bounty creation even if profile creation fails
      }
    }

    // Create the bounty using the service - include default status
    const bountyWithDefaults = {
      ...bountyData,
      status: "open" as const,
      timeline: bountyData.timeline || "",
      skills_required: bountyData.skills_required || "",
      location: bountyData.location || "",
    }
    
    const bounty = await bountyService.create(bountyWithDefaults)
    if (!bounty) {
      return { bounty: null, error: "Failed to create bounty" }
    }

    return { bounty, error: null }
  } catch (e: any) {
    console.error("Error in createBountyWithValidationUtil:", e)
    return { bounty: null, error: e.message || "Failed to create bounty" }
  }
}

/**
 * Accept a bounty request and update related data
 */
export const acceptBountyRequest = async (requestId: number): Promise<{ success: boolean; error: string | null }> => {
  try {
    const result = await bountyRequestService.acceptRequest(requestId)

    if (!result) {
      return { success: false, error: "Failed to accept request" }
    }

    return { success: true, error: null }
  } catch (err: any) {
    console.error("Error accepting bounty request:", err)
    return { success: false, error: err.message || "Failed to accept request" }
  }
}

/**
 * Reject a bounty request
 */
export const rejectBountyRequest = async (requestId: number): Promise<{ success: boolean; error: string | null }> => {
  try {
    const result = await bountyRequestService.rejectRequest(requestId)

    if (!result) {
      return { success: false, error: "Failed to reject request" }
    }

    return { success: true, error: null }
  } catch (err: any) {
    console.error("Error rejecting bounty request:", err)
    return { success: false, error: err.message || "Failed to reject request" }
  }
}

/**
 * Get bounties with distance calculations
 */
export const getBountiesWithDistance = async (): Promise<Bounty[]> => {
  try {
    const bounties = await bountyService.getAll();
    return bounties.map((bounty) => ({
      ...bounty,
      distance: calculateDistance(bounty.location || ""),
    }));
  } catch (e) {
    console.error("Error fetching bounties with distance:", e);
    return [];
  }
}
