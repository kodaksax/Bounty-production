-- Migration: Implement table partitioning for messages and wallet_transactions
-- Date: 2026-02-24
-- Description: Converts the messages and wallet_transactions tables to
--              PostgreSQL RANGE-partitioned tables (by created_at, yearly buckets).
--
-- Motivation:
--   Both tables grow unboundedly over time and are predominantly queried by
--   recency (conversation feed, transaction history).  Partitioning enables:
--     • Partition pruning on date-range queries  → faster reads
--     • Independent VACUUM / ANALYZE per partition → lower I/O contention
--     • Simple archival by detaching old partitions
--
-- Partitioning strategy:
--   RANGE on created_at (TIMESTAMPTZ), one partition per calendar year.
--   A DEFAULT partition catches rows with created_at outside all defined ranges.
--   Call create_yearly_partition() before each new year (e.g. via pg_cron).
--
-- Trade-offs / limitations:
--   1. Primary keys must include the partition key (id, created_at).
--      Code that looks up a row purely by id still works because PostgreSQL
--      searches all partitions for a PK-only lookup.
--   2. messages.reply_to previously had a self-referencing FK.
--      PostgreSQL does not support cross-partition self-referential FKs on
--      partitioned tables; that constraint is dropped.  Application-level
--      integrity (the reply target must exist) is enforced in the service layer.
--   3. The migration runs inside a single transaction.  If any step fails the
--      entire migration rolls back, leaving the original tables intact.

BEGIN;

-- ============================================================================
-- MESSAGES TABLE PARTITIONING
-- ============================================================================

-- Step 1: Preserve existing data under a temporary name
ALTER TABLE messages RENAME TO messages_old;

-- Step 2: Create the new partitioned parent table.
--         Column list is the union of all schema versions applied before this
--         migration (database/schema.sql + supabase/schema-messaging.sql +
--         services/api/migrations/20241119_messaging_tables.sql).
--         Nullable / defaulted columns cover fields that may not be present in
--         all schema variants.
CREATE TABLE messages (
    id              UUID        NOT NULL DEFAULT gen_random_uuid(),
    conversation_id UUID        NOT NULL,
    sender_id       UUID,
    user_id         UUID,
    text            TEXT,
    content         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    media_url       TEXT,
    -- reply_to kept as plain UUID; FK constraint removed (unsupported on
    -- partitioned tables with cross-partition references)
    reply_to        UUID,
    is_pinned       BOOLEAN     NOT NULL DEFAULT false,
    status          TEXT        NOT NULL DEFAULT 'sent'
) PARTITION BY RANGE (created_at);

-- Step 3: Create yearly partitions — historical + current year + two future years
CREATE TABLE messages_y2024
    PARTITION OF messages FOR VALUES FROM ('2024-01-01 00:00:00+00') TO ('2025-01-01 00:00:00+00');

CREATE TABLE messages_y2025
    PARTITION OF messages FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');

CREATE TABLE messages_y2026
    PARTITION OF messages FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE messages_y2027
    PARTITION OF messages FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');

-- Catch-all for rows outside the explicit yearly ranges
CREATE TABLE messages_default PARTITION OF messages DEFAULT;

-- Step 4: Primary key (partition key must be part of the PK on partitioned tables)
ALTER TABLE messages ADD PRIMARY KEY (id, created_at);

-- Step 5: Foreign keys to other tables (supported on partitioned tables)
ALTER TABLE messages
    ADD CONSTRAINT messages_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

ALTER TABLE messages
    ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Step 6: Migrate existing data
--         Use a dynamic INSERT so the migration handles both the simplified
--         schema (user_id/content) and the full schema (sender_id/text)
--         without hard-coding column names that may not exist.
DO $$
DECLARE
    has_sender_id   BOOLEAN;
    has_text_col    BOOLEAN;
    has_updated_at  BOOLEAN;
    has_media_url   BOOLEAN;
    has_reply_to    BOOLEAN;
    has_is_pinned   BOOLEAN;
    has_status_col  BOOLEAN;
    has_user_id     BOOLEAN;
    has_content     BOOLEAN;
    col_list        TEXT;
    val_list        TEXT;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'messages_old' AND column_name = 'sender_id')
      INTO has_sender_id;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'messages_old' AND column_name = 'text')
      INTO has_text_col;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'messages_old' AND column_name = 'updated_at')
      INTO has_updated_at;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'messages_old' AND column_name = 'media_url')
      INTO has_media_url;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'messages_old' AND column_name = 'reply_to')
      INTO has_reply_to;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'messages_old' AND column_name = 'is_pinned')
      INTO has_is_pinned;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'messages_old' AND column_name = 'status')
      INTO has_status_col;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'messages_old' AND column_name = 'user_id')
      INTO has_user_id;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'messages_old' AND column_name = 'content')
      INTO has_content;

    col_list := 'id, conversation_id, created_at';
    val_list := 'id, conversation_id, created_at';

    IF has_sender_id THEN
        col_list := col_list || ', sender_id';
        val_list := val_list || ', sender_id';
    END IF;
    IF has_user_id THEN
        col_list := col_list || ', user_id';
        val_list := val_list || ', user_id';
    END IF;
    IF has_text_col THEN
        col_list := col_list || ', text';
        val_list := val_list || ', text';
    END IF;
    IF has_content THEN
        col_list := col_list || ', content';
        val_list := val_list || ', content';
    END IF;
    IF has_updated_at THEN
        col_list := col_list || ', updated_at';
        val_list := val_list || ', updated_at';
    END IF;
    IF has_media_url THEN
        col_list := col_list || ', media_url';
        val_list := val_list || ', media_url';
    END IF;
    IF has_reply_to THEN
        col_list := col_list || ', reply_to';
        val_list := val_list || ', reply_to';
    END IF;
    IF has_is_pinned THEN
        col_list := col_list || ', is_pinned';
        val_list := val_list || ', is_pinned';
    END IF;
    IF has_status_col THEN
        col_list := col_list || ', status';
        val_list := val_list || ', status';
    END IF;

    EXECUTE FORMAT(
        'INSERT INTO messages (%s) SELECT %s FROM messages_old',
        col_list, val_list
    );
END $$;

-- Step 7: Indexes (automatically propagated to all existing and future partitions)
CREATE INDEX idx_messages_conversation_id
    ON messages(conversation_id, created_at DESC);

CREATE INDEX idx_messages_sender_id
    ON messages(sender_id);

CREATE INDEX idx_messages_reply_to
    ON messages(reply_to) WHERE reply_to IS NOT NULL;

CREATE INDEX idx_messages_conversation_id_created_at
    ON messages(conversation_id, created_at);

CREATE INDEX idx_messages_conversation_id_status
    ON messages(conversation_id, status);

CREATE INDEX idx_messages_is_pinned
    ON messages(conversation_id) WHERE is_pinned = true;

-- Step 8: Triggers
DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversation_on_message_insert ON messages;
CREATE TRIGGER update_conversation_on_message_insert
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();

-- Step 9: Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations"
    ON messages FOR SELECT
    USING (
        conversation_id IN (
            SELECT conversation_id FROM conversation_participants
            WHERE user_id = auth.uid()
              AND deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS "Users can send messages in their conversations" ON messages;
CREATE POLICY "Users can send messages in their conversations"
    ON messages FOR INSERT
    WITH CHECK (
        conversation_id IN (
            SELECT conversation_id FROM conversation_participants
            WHERE user_id = auth.uid()
              AND deleted_at IS NULL
        )
        AND sender_id = auth.uid()
    );

DROP POLICY IF EXISTS "Users can update their own messages" ON messages;
CREATE POLICY "Users can update their own messages"
    ON messages FOR UPDATE
    USING (sender_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own messages" ON messages;
CREATE POLICY "Users can delete their own messages"
    ON messages FOR DELETE
    USING (sender_id = auth.uid());

-- Step 10: Drop old (now-empty) table
DROP TABLE messages_old;


-- ============================================================================
-- WALLET TRANSACTIONS TABLE PARTITIONING
-- ============================================================================

-- Step 1: Preserve existing data under a temporary name
ALTER TABLE wallet_transactions RENAME TO wallet_transactions_old;

-- Step 2: Create new partitioned parent table.
--         Column list is the union of:
--           • database/schema.sql (base columns)
--           • 20251102_stripe_payments_integration.sql (Stripe columns + metadata)
--           • 20260208_add_reason_to_wallet_transactions.sql (reason column)
CREATE TABLE wallet_transactions (
    id                          UUID                  NOT NULL DEFAULT gen_random_uuid(),
    user_id                     UUID                  NOT NULL,
    type                        wallet_tx_type_enum   NOT NULL,
    amount                      NUMERIC(10,2)         NOT NULL,
    bounty_id                   UUID,
    description                 TEXT,
    status                      wallet_tx_status_enum NOT NULL DEFAULT 'pending',
    reason                      TEXT,
    stripe_payment_intent_id    TEXT,
    stripe_charge_id            TEXT,
    stripe_transfer_id          TEXT,
    stripe_connect_account_id   TEXT,
    metadata                    JSONB                 DEFAULT '{}'::jsonb,
    created_at                  TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ           NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Step 3: Yearly partitions
CREATE TABLE wallet_transactions_y2024
    PARTITION OF wallet_transactions FOR VALUES FROM ('2024-01-01 00:00:00+00') TO ('2025-01-01 00:00:00+00');

CREATE TABLE wallet_transactions_y2025
    PARTITION OF wallet_transactions FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');

CREATE TABLE wallet_transactions_y2026
    PARTITION OF wallet_transactions FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE wallet_transactions_y2027
    PARTITION OF wallet_transactions FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');

-- Catch-all
CREATE TABLE wallet_transactions_default PARTITION OF wallet_transactions DEFAULT;

-- Step 4: Primary key
ALTER TABLE wallet_transactions ADD PRIMARY KEY (id, created_at);

-- Step 5: Foreign keys
ALTER TABLE wallet_transactions
    ADD CONSTRAINT wallet_transactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT wallet_transactions_bounty_id_fkey
    FOREIGN KEY (bounty_id) REFERENCES bounties(id) ON DELETE SET NULL;

-- Step 6: Migrate existing data
--         Use a dynamic INSERT to handle schema variants (e.g. Stripe columns
--         may or may not exist depending on which migrations ran before this one).
DO $$
DECLARE
    has_reason                  BOOLEAN;
    has_stripe_pi               BOOLEAN;
    has_stripe_charge           BOOLEAN;
    has_stripe_transfer         BOOLEAN;
    has_stripe_connect          BOOLEAN;
    has_metadata                BOOLEAN;
    has_updated_at              BOOLEAN;
    col_list                    TEXT;
    val_list                    TEXT;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'wallet_transactions_old' AND column_name = 'reason')
      INTO has_reason;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'wallet_transactions_old' AND column_name = 'stripe_payment_intent_id')
      INTO has_stripe_pi;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'wallet_transactions_old' AND column_name = 'stripe_charge_id')
      INTO has_stripe_charge;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'wallet_transactions_old' AND column_name = 'stripe_transfer_id')
      INTO has_stripe_transfer;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'wallet_transactions_old' AND column_name = 'stripe_connect_account_id')
      INTO has_stripe_connect;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'wallet_transactions_old' AND column_name = 'metadata')
      INTO has_metadata;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'wallet_transactions_old' AND column_name = 'updated_at')
      INTO has_updated_at;

    col_list := 'id, user_id, type, amount, bounty_id, description, status, created_at';
    val_list := 'id, user_id, type, amount, bounty_id, description, status, created_at';

    IF has_updated_at THEN
        col_list := col_list || ', updated_at';
        val_list := val_list || ', updated_at';
    END IF;
    IF has_reason THEN
        col_list := col_list || ', reason';
        val_list := val_list || ', reason';
    END IF;
    IF has_stripe_pi THEN
        col_list := col_list || ', stripe_payment_intent_id';
        val_list := val_list || ', stripe_payment_intent_id';
    END IF;
    IF has_stripe_charge THEN
        col_list := col_list || ', stripe_charge_id';
        val_list := val_list || ', stripe_charge_id';
    END IF;
    IF has_stripe_transfer THEN
        col_list := col_list || ', stripe_transfer_id';
        val_list := val_list || ', stripe_transfer_id';
    END IF;
    IF has_stripe_connect THEN
        col_list := col_list || ', stripe_connect_account_id';
        val_list := val_list || ', stripe_connect_account_id';
    END IF;
    IF has_metadata THEN
        col_list := col_list || ', metadata';
        val_list := val_list || ', metadata';
    END IF;

    EXECUTE FORMAT(
        'INSERT INTO wallet_transactions (%s) SELECT %s FROM wallet_transactions_old',
        col_list, val_list
    );
END $$;

-- Step 7: Indexes
CREATE INDEX idx_wallet_transactions_user_id
    ON wallet_transactions(user_id);

CREATE INDEX idx_wallet_transactions_user_id_created_at
    ON wallet_transactions(user_id, created_at DESC);

CREATE INDEX idx_wallet_transactions_bounty_id
    ON wallet_transactions(bounty_id) WHERE bounty_id IS NOT NULL;

CREATE INDEX idx_wallet_transactions_type
    ON wallet_transactions(type);

CREATE INDEX idx_wallet_transactions_status
    ON wallet_transactions(status);

CREATE INDEX idx_wallet_transactions_user_id_type
    ON wallet_transactions(user_id, type);

CREATE INDEX idx_wallet_tx_stripe_payment_intent
    ON wallet_transactions(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX idx_wallet_tx_stripe_charge
    ON wallet_transactions(stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;

CREATE INDEX idx_wallet_tx_stripe_transfer
    ON wallet_transactions(stripe_transfer_id) WHERE stripe_transfer_id IS NOT NULL;

-- Step 8: Trigger for updated_at
DROP TRIGGER IF EXISTS trg_wallet_transactions_updated_at ON wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_updated_at
    BEFORE UPDATE ON wallet_transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Step 9: Drop old table
DROP TABLE wallet_transactions_old;


-- ============================================================================
-- PARTITION MANAGEMENT UTILITY
-- ============================================================================

-- Creates a new yearly partition for a given partitioned table if it does not
-- already exist.  Returns a human-readable status message.
--
-- Usage:
--   SELECT create_yearly_partition('messages', '2028-01-01'::timestamptz);
--   SELECT create_yearly_partition('wallet_transactions', '2029-06-15'::timestamptz);
--
-- Automate via pg_cron (run once per year, e.g. on 1 Dec to pre-create next year):
--   SELECT cron.schedule(
--     'create-yearly-partitions',
--     '0 0 1 12 *',
--     $$
--       SELECT create_yearly_partition('messages', NOW() + INTERVAL '1 year');
--       SELECT create_yearly_partition('wallet_transactions', NOW() + INTERVAL '1 year');
--     $$
--   );

CREATE OR REPLACE FUNCTION create_yearly_partition(
    parent_table    TEXT,
    partition_date  TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TEXT AS $$
DECLARE
    partition_name  TEXT;
    start_date      TIMESTAMPTZ;
    end_date        TIMESTAMPTZ;
BEGIN
    start_date     := DATE_TRUNC('year', partition_date);
    end_date       := start_date + INTERVAL '1 year';
    partition_name := parent_table || '_y' || TO_CHAR(start_date, 'YYYY');

    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = partition_name
          AND n.nspname = current_schema()
    ) THEN
        RETURN 'Partition already exists: ' || partition_name;
    END IF;

    EXECUTE FORMAT(
        'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        partition_name, parent_table, start_date, end_date
    );

    RETURN 'Created partition: ' || partition_name;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
    -- Verify messages is now a partitioned table
    IF NOT EXISTS (
        SELECT 1 FROM pg_partitioned_table pt
        JOIN pg_class c ON c.oid = pt.partrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'messages' AND n.nspname = 'public'
    ) THEN
        RAISE EXCEPTION 'messages table is not partitioned';
    END IF;

    -- Verify wallet_transactions is now a partitioned table
    IF NOT EXISTS (
        SELECT 1 FROM pg_partitioned_table pt
        JOIN pg_class c ON c.oid = pt.partrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'wallet_transactions' AND n.nspname = 'public'
    ) THEN
        RAISE EXCEPTION 'wallet_transactions table is not partitioned';
    END IF;

    RAISE NOTICE 'Partitioning migration completed successfully.';
    RAISE NOTICE '  messages:             partitioned (yearly, created_at)';
    RAISE NOTICE '  wallet_transactions:  partitioned (yearly, created_at)';
    RAISE NOTICE 'To create future partitions call: SELECT create_yearly_partition(''<table>'', ''<date>'');';
END $$;

COMMIT;
