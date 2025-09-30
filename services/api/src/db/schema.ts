import { pgTable, text, integer, boolean, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Define relations
export const usersRelations = relations(users, ({ many }) => ({
  bounties: many(bounties),
}));

export const bountiesRelations = relations(bounties, ({ one }) => ({
  creator: one(users, {
    fields: [bounties.creator_id],
    references: [users.id],
  }),
}));
