import { bountyRequestService } from "lib/services/bounty-request-service"
import { bountyService } from "lib/services/bounty-service"
import { profileService } from "lib/services/profile-service"
// import types from new Hostinger backend if available
// Define Profile type here for now
export type Profile = {
  id: string;
  username: string;
  email: string;
  balance: number;
  // ...other fields as needed
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
  // ...other fields as needed
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

// Update the getCurrentUserProfile function to get the actual user ID
export const getCurrentUserProfile = async (): Promise<Profile | null> => {
  // Replace with your Hostinger API endpoint
  try {
    const res = await fetch("https://your-hostinger-domain/api/profile", {
      credentials: "include", // or use Authorization header for JWT
    });
    if (!res.ok) return null;
    const profile = await res.json();
    return profile;
  } catch (e) {
    return null;
  }
}

// Add a function to get the current user ID
export const getCurrentUserId = async (): Promise<string| null> => {
  // Replace with your Hostinger API endpoint
  const res = await fetch('https://your-hostinger-domain/api/user-id');
  if (!res.ok) return null;
  const userId = await res.text();
  return userId;
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
    let user = null
    try {
      user = await profileService.getById(bountyData.user_id)
    } catch (err) {
      console.log("Error checking if user exists:", err)
      // Continue with user creation regardless of error
    }

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
      }

      await profileService.create(defaultProfile)
    }

    // Now create the bounty
    const bounty: Bounty | null = await bountyService.create({
     ...bountyData,
    status: "open",
    timeline: "", // or any default value
    skills_required: "", // or any default value
    location: bountyData.location ?? "", // use a default value if location is undefined
    })

    return { bounty, error: null }
  } catch (e: any) {
  return { bounty: null, error: e.message || "Failed to create bounty" };
}
}

/**
 * Accept a bounty request and update related data
 */
export const acceptBountyRequest = async (requestId: number): Promise<{ success: boolean; error: string | null }> => {
  try {
    const result = await bountyRequestService.acceptRequest(requestId)

    if (!result.request || !result.bounty) {
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
      return { success: false, error: "Failed to reject request" } // Add this line
    }
    // ... rest of the code ...
    return { success: true, error: null } // Add this line
  } catch (err: any) {
    console.error("Error rejecting bounty request:", err)
    return { success: false, error: err.message || "Failed to reject request" }
  }
}
  export const getBountiesWithDistance = async (): Promise<Bounty[]> => {
    try {
      const res = await fetch("https://your-hostinger-domain/api/bounties", {
        credentials: "include",
      });
      if (!res.ok) return [];
      const bounties: Bounty[] = await res.json();
      return bounties.map((bounty) => ({
        ...bounty,
        distance: calculateDistance(bounty.location || ""),
      }));
    } catch (e) {
      return [];
    }
  }

/**
 * Update user skills
 */

export const updateUserSkills = async (/* function parameters */) => {
  // function implementation
}

export const createBountyWithValidation = async (
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
    // Add more validation as needed
    try {
      const res = await fetch("https://your-hostinger-domain/api/bounties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(bountyData),
      });
      if (!res.ok) {
        const err = await res.text();
        return { bounty: null, error: err || "Failed to create bounty" };
      }
      const bounty: Bounty = await res.json();
      return { bounty, error: null };
    } catch (e: any) {
      return { bounty: null, error: e.message || "Failed to create bounty" };
    }
  }
