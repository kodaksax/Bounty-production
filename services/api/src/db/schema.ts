import { relations } from 'drizzle-orm';
import { boolean, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// Users table as specified in requirements
// Map the code's `users` symbol to the existing `profiles` table in the database.
// Several parts of the codebase (and Supabase) use `profiles.username` and
// `profiles.stripe_connect_account_id`. We expose these as the properties
// `handle` and `stripe_account_id` here so the service code doesn't need
// to change.
export const users = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: text('handle').notNull(),
  stripe_account_id: text('stripe_account_id'),
  // Compliance and verification fields
  verification_status: text('verification_status').default('pending').notNull(), // pending, verified, rejected, under_review
  kyc_verified_at: timestamp('kyc_verified_at', { withTimezone: true }),
  business_category: text('business_category'), // Track seller business type
  risk_level: text('risk_level').default('low').notNull(), // low, medium, high, critical
  risk_score: integer('risk_score').default(0).notNull(), // 0-100 numeric risk score
  account_restricted: boolean('account_restricted').default(false).notNull(),
  restriction_reason: text('restriction_reason'),
  restricted_at: timestamp('restricted_at', { withTimezone: true }),
  // property name `handle` maps to column `username`
  handle: text('username').notNull(),
  // property name `stripe_account_id` maps to column `stripe_connect_account_id`
  stripe_account_id: text('stripe_connect_account_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }), // Soft delete timestamp (if present)
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
  riskAssessments: many(riskAssessments),
  riskActions: many(riskActions),
  platformReserves: many(platformReserves),
  riskCommunications: many(riskCommunications),
  remediationWorkflows: many(remediationWorkflows),
  transactionPatterns: many(transactionPatterns),
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

// Risk Management Tables

// Restricted business categories table
export const restrictedBusinessCategories = pgTable('restricted_business_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  category_code: text('category_code').notNull().unique(), // e.g., 'gambling', 'adult_content', 'weapons'
  category_name: text('category_name').notNull(),
  description: text('description'),
  risk_level: text('risk_level').notNull().default('high'), // low, medium, high, prohibited
  is_prohibited: boolean('is_prohibited').default(false).notNull(), // Completely blocked categories
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Risk assessments table - track risk evaluation history
export const riskAssessments = pgTable('risk_assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  assessment_type: text('assessment_type').notNull(), // onboarding, periodic, triggered, manual
  risk_score: integer('risk_score').notNull(), // 0-100
  risk_level: text('risk_level').notNull(), // low, medium, high, critical
  factors: jsonb('factors').notNull(), // Detailed risk factors and their weights
  assessed_by: text('assessed_by').notNull(), // system, admin_user_id, or automated_system
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Risk actions table - track mitigation actions taken
export const riskActions = pgTable('risk_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  action_type: text('action_type').notNull(), // hold, restrict, delay_payout, require_verification, suspend, flag_for_review
  reason: text('reason').notNull(),
  severity: text('severity').notNull(), // low, medium, high, critical
  status: text('status').notNull().default('active'), // active, resolved, cancelled
  automated: boolean('automated').default(false).notNull(), // Was this action automated?
  triggered_by: text('triggered_by'), // What triggered this action (e.g., 'high_transaction_volume', 'fraud_pattern')
  metadata: jsonb('metadata'), // Additional context like transaction IDs, amounts, etc.
  actioned_by: text('actioned_by').notNull(), // admin_user_id or system
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  resolved_by: text('resolved_by'),
  resolution_notes: text('resolution_notes'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Platform reserves table - track reserves held for liability coverage
export const platformReserves = pgTable('platform_reserves', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  reserve_type: text('reserve_type').notNull(), // rolling, fixed, transaction_based
  amount_cents: integer('amount_cents').notNull(), // Amount held in reserve
  percentage: integer('percentage'), // If percentage-based (e.g., 10 = 10%)
  reason: text('reason').notNull(),
  status: text('status').notNull().default('active'), // active, released, expired
  release_date: timestamp('release_date', { withTimezone: true }), // When reserve can be released
  released_at: timestamp('released_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Risk communication logs - audit trail of all risk-related communications
export const riskCommunications = pgTable('risk_communications', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  risk_action_id: uuid('risk_action_id').references(() => riskActions.id),
  communication_type: text('communication_type').notNull(), // email, in_app, sms, push
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('sent'), // sent, delivered, read, failed
  metadata: jsonb('metadata'), // Delivery receipts, tracking info, etc.
  sent_at: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  delivered_at: timestamp('delivered_at', { withTimezone: true }),
  read_at: timestamp('read_at', { withTimezone: true }),
});

// Seller remediation workflows
export const remediationWorkflows = pgTable('remediation_workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  risk_action_id: uuid('risk_action_id').references(() => riskActions.id).notNull(),
  workflow_type: text('workflow_type').notNull(), // document_verification, identity_check, business_verification, transaction_review
  status: text('status').notNull().default('pending'), // pending, in_progress, completed, failed, cancelled
  required_documents: jsonb('required_documents'), // List of required documents/info
  submitted_documents: jsonb('submitted_documents'), // Documents submitted by user
  review_notes: text('review_notes'),
  reviewed_by: text('reviewed_by'),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Transaction monitoring patterns - detect fraud/risk patterns
export const transactionPatterns = pgTable('transaction_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  pattern_type: text('pattern_type').notNull(), // high_velocity, unusual_amount, geographic_anomaly, chargebacks, refund_pattern
  severity: text('severity').notNull(), // low, medium, high, critical
  details: jsonb('details').notNull(), // Pattern-specific data
  threshold_exceeded: boolean('threshold_exceeded').default(false).notNull(),
  action_taken: text('action_taken'), // Reference to risk_actions if action was taken
  reviewed: boolean('reviewed').default(false).notNull(),
  reviewed_by: text('reviewed_by'),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  detected_at: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
});

// Define relations for new risk management tables
export const riskAssessmentsRelations = relations(riskAssessments, ({ one }) => ({
  user: one(users, {
    fields: [riskAssessments.user_id],
    references: [users.id],
  }),
}));

export const riskActionsRelations = relations(riskActions, ({ one, many }) => ({
  user: one(users, {
    fields: [riskActions.user_id],
    references: [users.id],
  }),
  communications: many(riskCommunications),
  remediationWorkflows: many(remediationWorkflows),
}));

export const platformReservesRelations = relations(platformReserves, ({ one }) => ({
  user: one(users, {
    fields: [platformReserves.user_id],
    references: [users.id],
  }),
}));

export const riskCommunicationsRelations = relations(riskCommunications, ({ one }) => ({
  user: one(users, {
    fields: [riskCommunications.user_id],
    references: [users.id],
  }),
  riskAction: one(riskActions, {
    fields: [riskCommunications.risk_action_id],
    references: [riskActions.id],
  }),
}));

export const remediationWorkflowsRelations = relations(remediationWorkflows, ({ one }) => ({
  user: one(users, {
    fields: [remediationWorkflows.user_id],
    references: [users.id],
  }),
  riskAction: one(riskActions, {
    fields: [remediationWorkflows.risk_action_id],
    references: [riskActions.id],
  }),
}));

export const transactionPatternsRelations = relations(transactionPatterns, ({ one }) => ({
  user: one(users, {
    fields: [transactionPatterns.user_id],
    references: [users.id],
  }),
}));
