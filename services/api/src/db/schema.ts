import { relations } from 'drizzle-orm';
import { boolean, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// Users table as specified in requirements
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: text('handle').notNull(),
  stripe_account_id: text('stripe_account_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }), // Soft delete timestamp
});

// Bounties table as specified in requirements
export const bounties = pgTable('bounties', {
  id: uuid('id').primaryKey().defaultRandom(),
  creator_id: uuid('creator_id').references(() => users.id).notNull(),
  hunter_id: uuid('hunter_id').references(() => users.id), // Who accepted/is working on the bounty
  title: text('title').notNull(),
  description: text('description').notNull(),
  amount_cents: integer('amount_cents').notNull().default(0),
  is_for_honor: boolean('is_for_honor').default(false).notNull(),
  status: text('status').notNull().default('open'),
  payment_intent_id: text('payment_intent_id'), // Store Stripe PaymentIntent ID for escrow
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  is_stale: boolean('is_stale').default(false).notNull(), // Flag for stale bounties (hunter deleted)
  stale_reason: text('stale_reason'), // Reason why bounty became stale (e.g., 'hunter_deleted')
  stale_detected_at: timestamp('stale_detected_at', { withTimezone: true }), // When stale was detected
});

// Wallet transactions table for tracking financial movements
export const walletTransactions = pgTable('wallet_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  bounty_id: uuid('bounty_id').references(() => bounties.id),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  type: text('type').notNull(), // escrow, release, refund, etc.
  amount_cents: integer('amount_cents').notNull(),
  stripe_transfer_id: text('stripe_transfer_id'), // Store Stripe Transfer ID for release transactions
  platform_fee_cents: integer('platform_fee_cents').default(0), // Platform fee for the transaction
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Unique constraint to prevent double releases
  unique_bounty_release: unique().on(table.bounty_id, table.type),
}));

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

// Notifications table for in-app and push notifications
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id).notNull(), // Recipient of the notification
  type: text('type').notNull(), // application, acceptance, completion, payment, message, follow
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: jsonb('data'), // Additional data like bounty_id, message_id, etc.
  read: boolean('read').default(false).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Push notification tokens table for Expo Push
export const pushTokens = pgTable('push_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  token: text('token').notNull(),
  device_id: text('device_id'), // Optional device identifier
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Notification preferences table for controlling which notifications users receive
export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id).notNull().unique(),
  applications_enabled: boolean('applications_enabled').default(true).notNull(), // Bounty applications
  acceptances_enabled: boolean('acceptances_enabled').default(true).notNull(), // Bounty acceptances
  completions_enabled: boolean('completions_enabled').default(true).notNull(), // Bounty completions
  payments_enabled: boolean('payments_enabled').default(true).notNull(), // Payment notifications
  messages_enabled: boolean('messages_enabled').default(true).notNull(), // Chat messages
  follows_enabled: boolean('follows_enabled').default(true).notNull(), // New followers
  reminders_enabled: boolean('reminders_enabled').default(true).notNull(), // Reminders
  system_enabled: boolean('system_enabled').default(true).notNull(), // System notifications
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Conversations table for messaging
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  is_group: boolean('is_group').default(false).notNull(),
  bounty_id: uuid('bounty_id').references(() => bounties.id),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Conversation participants table
export const conversationParticipants = pgTable('conversation_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversation_id: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  joined_at: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }), // Soft delete
  last_read_at: timestamp('last_read_at', { withTimezone: true }),
}, (table) => ({
  // Unique constraint to ensure a user can only be in a conversation once
  unique_conversation_user: unique().on(table.conversation_id, table.user_id),
}));

// Messages table
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversation_id: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  sender_id: uuid('sender_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  text: text('text').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  media_url: text('media_url'),
  reply_to: uuid('reply_to'),
  is_pinned: boolean('is_pinned').default(false).notNull(),
  status: text('status').default('sent').notNull(), // sent, delivered, read
}, (table) => ({
  replyToSelfReference: foreignKey({
    name: 'messages_reply_to_fkey',
    columns: [table.reply_to],
    foreignColumns: [table.id],
  }).onDelete('set null'),
}));

// Define relations
export const usersRelations = relations(users, ({ many, one }) => ({
  bounties: many(bounties),
  walletTransactions: many(walletTransactions),
  notifications: many(notifications),
  pushTokens: many(pushTokens),
  notificationPreferences: one(notificationPreferences),
  conversationParticipants: many(conversationParticipants),
  sentMessages: many(messages),
}));

export const bountiesRelations = relations(bounties, ({ one, many }) => ({
  creator: one(users, {
    fields: [bounties.creator_id],
    references: [users.id],
  }),
  walletTransactions: many(walletTransactions),
  conversations: many(conversations),
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

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.user_id],
    references: [users.id],
  }),
}));

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, {
    fields: [pushTokens.user_id],
    references: [users.id],
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.user_id],
    references: [users.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  bounty: one(bounties, {
    fields: [conversations.bounty_id],
    references: [bounties.id],
  }),
  participants: many(conversationParticipants),
  messages: many(messages),
}));

export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationParticipants.conversation_id],
    references: [conversations.id],
  }),
  user: one(users, {
    fields: [conversationParticipants.user_id],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversation_id],
    references: [conversations.id],
  }),
  sender: one(users, {
    fields: [messages.sender_id],
    references: [users.id],
  }),
  replyToMessage: one(messages, {
    fields: [messages.reply_to],
    references: [messages.id],
  }),
}));
