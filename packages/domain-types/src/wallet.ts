import { z } from 'zod';

// Core types
export type Money = number; // USD for now

export type TransactionType = "escrow" | "release" | "refund" | "deposit" | "withdrawal";

// TypeScript interfaces
export interface WalletTransaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: Money;
  bountyId?: string;
  description?: string;
  status: "pending" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt?: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  balance: Money;
  escrowBalance: Money;
  createdAt: string;
  updatedAt: string;
}

// Zod schemas for validation
export const TransactionTypeSchema = z.enum(["escrow", "release", "refund", "deposit", "withdrawal"]);

export const TransactionStatusSchema = z.enum(["pending", "completed", "failed", "cancelled"]);

export const WalletTransactionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  type: TransactionTypeSchema,
  amount: z.number().positive("Amount must be positive"),
  bountyId: z.string().optional(),
  description: z.string().optional(),
  status: TransactionStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().optional(),
});

export const CreateWalletTransactionSchema = WalletTransactionSchema.omit({
  id: true,
  createdAt: true,
  completedAt: true,
}).extend({
  status: TransactionStatusSchema.optional().default("pending"),
});

export const WalletSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  balance: z.number().min(0, "Balance cannot be negative"),
  escrowBalance: z.number().min(0, "Escrow balance cannot be negative"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Type inference from schemas
export type WalletTransactionInput = z.infer<typeof WalletTransactionSchema>;
export type CreateWalletTransactionInput = z.infer<typeof CreateWalletTransactionSchema>;
export type WalletInput = z.infer<typeof WalletSchema>;