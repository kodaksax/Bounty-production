import { pgTable, text, integer, boolean, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table as specified in requirements
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: text('handle').notNull(),
  stripe_account_id: text('stripe_account_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Bounties table as specified in requirements
export const bounties = pgTable('bounties', {
  id: uuid('id').primaryKey().defaultRandom(),
  creator_id: uuid('creator_id').references(() => users.id).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  amount_cents: integer('amount_cents').notNull().default(0),
  is_for_honor: boolean('is_for_honor').default(false).notNull(),
  status: text('status').notNull().default('open'),
  payment_intent_id: text('payment_intent_id'), // Store Stripe PaymentIntent ID for escrow
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Wallet transactions table for tracking financial movements
export const walletTransactions = pgTable('wallet_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  bounty_id: uuid('bounty_id').references(() => bounties.id),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  type: text('type').notNull(), // escrow, release, refund, etc.
  amount_cents: integer('amount_cents').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Outbox events table for reliable event processing
export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(), // BOUNTY_ACCEPTED, BOUNTY_COMPLETED, ESCROW_HOLD, etc.
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'), // pending, processing, completed, failed
  retry_count: integer('retry_count').notNull().default(0), // For exponential backoff
  retry_metadata: jsonb('retry_metadata'), // Store retry-specific data like next_retry_at
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }),
});

// Define relations
export const usersRelations = relations(users, ({ many }) => ({
  bounties: many(bounties),
  walletTransactions: many(walletTransactions),
}));

export const bountiesRelations = relations(bounties, ({ one, many }) => ({
  creator: one(users, {
    fields: [bounties.creator_id],
    references: [users.id],
  }),
  walletTransactions: many(walletTransactions),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  user: one(users, {
    fields: [walletTransactions.user_id],
    references: [users.id],
  }),
  bounty: one(bounties, {
    fields: [walletTransactions.bounty_id],
    references: [bounties.id],
  }),
}));
