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

// Outbox event types for reliable event processing
export type OutboxEventType = "BOUNTY_ACCEPTED" | "BOUNTY_COMPLETED" | "ESCROW_HOLD";

export type OutboxEventStatus = "pending" | "processing" | "completed" | "failed";

export interface OutboxEvent {
  id: string;
  type: OutboxEventType;
  payload: Record<string, any>;
  status: OutboxEventStatus;
  retry_count: number;
  retry_metadata?: Record<string, any>;
  created_at: string;
  processed_at?: string;
}

// Zod schemas for outbox events
export const OutboxEventTypeSchema = z.enum(["BOUNTY_ACCEPTED", "BOUNTY_COMPLETED", "ESCROW_HOLD"]);

export const OutboxEventStatusSchema = z.enum(["pending", "processing", "completed", "failed"]);

export const OutboxEventSchema = z.object({
  id: z.string(),
  type: OutboxEventTypeSchema,
  payload: z.record(z.any()),
  status: OutboxEventStatusSchema,
  retry_count: z.number().default(0),
  retry_metadata: z.record(z.any()).optional(),
  created_at: z.string(),
  processed_at: z.string().optional(),
});

export const CreateOutboxEventSchema = OutboxEventSchema.omit({
  id: true,
  created_at: true,
  processed_at: true,
}).extend({
  status: OutboxEventStatusSchema.optional().default("pending"),
  retry_count: z.number().optional().default(0),
});

// Type inference from schemas
export type WalletTransactionInput = z.infer<typeof WalletTransactionSchema>;
export type CreateWalletTransactionInput = z.infer<typeof CreateWalletTransactionSchema>;
export type WalletInput = z.infer<typeof WalletSchema>;
export type OutboxEventInput = z.infer<typeof OutboxEventSchema>;
export type CreateOutboxEventInput = z.infer<typeof CreateOutboxEventSchema>;