import { z } from "zod";

// Valid bounty statuses
export type BountyStatus = "open" | "in_progress" | "completed" | "archived";

// Valid transitions between statuses
export type BountyTransition = "accept" | "complete" | "archive";

// Validation schema for bounty data
export const bountyCreateSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  description: z.string().min(20, "Description must be at least 20 characters"),
  amount: z.number().min(0, "Amount cannot be negative").optional(),
  is_for_honor: z.boolean().default(false),
  location: z.string().min(3, "Location is required").optional(),
  timeline: z.string().optional(),
  skills_required: z.string().optional(),
  user_id: z.string().min(1, "User ID is required"), // Less strict UUID validation for compatibility
  work_type: z.enum(['online', 'in_person']).default('online'),
  is_time_sensitive: z.boolean().default(false),
  deadline: z.string().optional(),
  attachments_json: z.string().optional(),
});

export const bountyUpdateSchema = bountyCreateSchema.partial().omit({ user_id: true });

export const bountyFilterSchema = z.object({
  status: z.enum(["open", "in_progress", "completed", "archived"]).optional(),
  user_id: z.string().min(1).optional(), // Less strict for filtering too
  work_type: z.enum(['online', 'in_person']).optional(),
});

// Define valid state transitions
const VALID_TRANSITIONS: Record<BountyStatus, BountyStatus[]> = {
  open: ["in_progress", "archived"],
  in_progress: ["completed", "archived"],
  completed: ["archived"],
  archived: [],
};

// Define which transitions correspond to which new statuses
const TRANSITION_TO_STATUS: Record<BountyTransition, BountyStatus> = {
  accept: "in_progress",
  complete: "completed", 
  archive: "archived",
};

/**
 * Pure domain function to validate and perform bounty status transitions
 * @param currentStatus - Current bounty status
 * @param transition - Requested transition
 * @returns Object with success flag and new status or error message
 */
export function transitionBounty(
  currentStatus: BountyStatus,
  transition: BountyTransition
): { success: true; newStatus: BountyStatus } | { success: false; error: string } {
  const newStatus = TRANSITION_TO_STATUS[transition];
  
  if (!newStatus) {
    return {
      success: false,
      error: `Invalid transition: ${transition}`,
    };
  }

  const validNextStatuses = VALID_TRANSITIONS[currentStatus];
  
  if (!validNextStatuses.includes(newStatus)) {
    return {
      success: false,
      error: `Cannot transition from ${currentStatus} to ${newStatus}. Valid transitions: ${validNextStatuses.join(", ")}`,
    };
  }

  return {
    success: true,
    newStatus,
  };
}

/**
 * Check if a transition is valid without performing it
 * @param currentStatus - Current bounty status
 * @param transition - Requested transition
 * @returns boolean indicating if transition is valid
 */
export function isValidTransition(
  currentStatus: BountyStatus,
  transition: BountyTransition
): boolean {
  const result = transitionBounty(currentStatus, transition);
  return result.success;
}

/**
 * Get all valid transitions from a given status
 * @param currentStatus - Current bounty status
 * @returns Array of valid transition names
 */
export function getValidTransitions(currentStatus: BountyStatus): BountyTransition[] {
  const validNextStatuses = VALID_TRANSITIONS[currentStatus];
  const transitions: BountyTransition[] = [];
  
  if (validNextStatuses.includes("in_progress")) {
    transitions.push("accept");
  }
  if (validNextStatuses.includes("completed")) {
    transitions.push("complete");
  }
  if (validNextStatuses.includes("archived")) {
    transitions.push("archive");
  }
  
  return transitions;
}