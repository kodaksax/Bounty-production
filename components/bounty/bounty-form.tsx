// Validation schema for the bounty create/update path in
// lib/services/enhanced-bounty-service.ts. The BountyForm component that used
// to live here was never rendered anywhere and has been removed; the app's
// composer is app/screens/CreateBounty.
import { z as zod } from "zod";

export const bountySchema = zod.object({
  title: zod.string().min(5, "Title must be at least 5 characters"),
  description: zod.string().min(20, "Description must be at least 20 characters"),
  amount: zod.number().min(0, "Amount cannot be negative"),
  is_for_honor: zod.boolean(),
  location: zod.string().min(3, "Location is required"),
  timeline: zod.string().optional(),
  skills_required: zod.string().optional(),
})
