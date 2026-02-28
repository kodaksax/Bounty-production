import { z } from 'zod';

// Core types
export type Money = number; // USD for now

export type BountyStatus = "open" | "in_progress" | "completed" | "archived";

// TypeScript interfaces
export interface Bounty {
  id: string | number;
  user_id: string;
  title: string;
  description: string;
  amount?: Money;
  isForHonor?: boolean;
  location?: string;
  createdAt?: string;
  status?: BountyStatus;
}

export interface BountyFormValues {
  title: string;
  description: string;
  amount: number;
  is_for_honor: boolean;
  location: string;
  timeline: string;
  skills_required: string;
  status: string;
}

// Zod schemas for validation
export const BountyStatusSchema = z.enum(["open", "in_progress", "completed", "archived"]);

export const BountySchema = z.object({
  id: z.union([z.string(), z.number()]),
  user_id: z.string(),
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  amount: z.number().positive().optional(),
  isForHonor: z.boolean().optional(),
  location: z.string().optional(),
  createdAt: z.string().optional(),
  status: BountyStatusSchema.optional(),
});

export const BountyFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  amount: z.number().positive(),
  is_for_honor: z.boolean(),
  location: z.string(),
  timeline: z.string(),
  skills_required: z.string(),
  status: z.string(),
});

// Type inference from schemas
export type BountyInput = z.infer<typeof BountySchema>;
export type BountyFormInput = z.infer<typeof BountyFormSchema>;