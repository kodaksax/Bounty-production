import { z } from 'zod';

// TypeScript interfaces
export interface UserProfile {
  id: string;
  username: string;
  email: string;
  displayName?: string;
  avatar?: string;
  bio?: string;
  location?: string;
  skills?: string[];
  rating?: number;
  totalBountiesCompleted?: number;
  totalBountiesPosted?: number;
  createdAt?: string;
  updatedAt?: string;
}

// Zod schemas for validation
export const UserProfileSchema = z.object({
  id: z.string(),
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  displayName: z.string().optional(),
  avatar: z.string().url().optional(),
  bio: z.string().max(500, "Bio must be 500 characters or less").optional(),
  location: z.string().optional(),
  skills: z.array(z.string()).optional(),
  rating: z.number().min(0).max(5).optional(),
  totalBountiesCompleted: z.number().min(0).optional(),
  totalBountiesPosted: z.number().min(0).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const CreateUserProfileSchema = UserProfileSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  totalBountiesCompleted: true,
  totalBountiesPosted: true,
  rating: true,
});

export const UpdateUserProfileSchema = UserProfileSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();

// Type inference from schemas
export type UserProfileInput = z.infer<typeof UserProfileSchema>;
export type CreateUserProfileInput = z.infer<typeof CreateUserProfileSchema>;
export type UpdateUserProfileInput = z.infer<typeof UpdateUserProfileSchema>;