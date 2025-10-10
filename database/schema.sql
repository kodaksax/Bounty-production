-- BountyExpo Database Schema (Postgres/Supabase)
-- This script DROPS and RECREATES all related tables and types.
-- WARNING: Running this will remove existing data in the dropped tables.

-- Extensions commonly available on Supabase (for gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop dependent tables first (to replace existing schema)
DROP TABLE IF EXISTS conversation_participants CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS bounty_requests CASCADE;
DROP TABLE IF EXISTS wallet_transactions CASCADE;
DROP TABLE IF EXISTS skills CASCADE;
DROP TABLE IF EXISTS bounties CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Drop enum types if they already exist
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bounty_status_enum') THEN
        DROP TYPE bounty_status_enum;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_type_enum') THEN
        DROP TYPE work_type_enum;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status_enum') THEN
        DROP TYPE request_status_enum;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_tx_type_enum') THEN
        DROP TYPE wallet_tx_type_enum;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_tx_status_enum') THEN
        DROP TYPE wallet_tx_status_enum;
    END IF;
END $$;

-- Recreate enum types
CREATE TYPE bounty_status_enum AS ENUM ('open', 'in_progress', 'completed', 'archived');
CREATE TYPE work_type_enum AS ENUM ('online', 'in_person');
CREATE TYPE request_status_enum AS ENUM ('pending', 'accepted', 'rejected');
CREATE TYPE wallet_tx_type_enum AS ENUM ('escrow', 'release', 'refund', 'deposit', 'withdrawal');
CREATE TYPE wallet_tx_status_enum AS ENUM ('pending', 'completed', 'failed');

-- Helper trigger to auto-update updated_at columns
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Profiles: mirror Supabase auth.users(id) as UUID primary key
CREATE TABLE profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username text NOT NULL UNIQUE,
    email text UNIQUE,
    avatar text,
    about text,
    phone text,
    balance numeric(10,2) NOT NULL DEFAULT 0.00,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Bounties
CREATE TABLE bounties (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text NOT NULL,
    amount numeric(10,2) NOT NULL DEFAULT 0.00,
    is_for_honor boolean NOT NULL DEFAULT FALSE,
    location text,
    timeline text,
    skills_required text,
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status bounty_status_enum NOT NULL DEFAULT 'open',
    work_type work_type_enum NOT NULL DEFAULT 'online',
    is_time_sensitive boolean NOT NULL DEFAULT FALSE,
    deadline timestamptz NULL,
    attachments_json jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_bounties_updated_at
BEFORE UPDATE ON bounties
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Skills
CREATE TABLE skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    icon text,
    text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Bounty Requests
CREATE TABLE bounty_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bounty_id uuid NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status request_status_enum NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_bounty_user UNIQUE (bounty_id, user_id)
);

CREATE TRIGGER trg_bounty_requests_updated_at
BEFORE UPDATE ON bounty_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Conversations
CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bounty_id uuid REFERENCES bounties(id) ON DELETE SET NULL,
    is_group boolean NOT NULL DEFAULT FALSE,
    name text NOT NULL,
    avatar text,
    last_message text,
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Conversation participants
CREATE TABLE conversation_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_conversation_user UNIQUE (conversation_id, user_id)
);

-- Messages
CREATE TABLE messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Wallet transactions
CREATE TABLE wallet_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type wallet_tx_type_enum NOT NULL,
    amount numeric(10,2) NOT NULL,
    bounty_id uuid REFERENCES bounties(id) ON DELETE SET NULL,
    description text,
    status wallet_tx_status_enum NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_wallet_transactions_updated_at
BEFORE UPDATE ON wallet_transactions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes for performance
CREATE INDEX idx_bounties_user_id ON bounties(user_id);
CREATE INDEX idx_bounties_status ON bounties(status);
CREATE INDEX idx_bounties_created_at ON bounties(created_at);
CREATE INDEX idx_bounty_requests_bounty_id ON bounty_requests(bounty_id);
CREATE INDEX idx_bounty_requests_user_id ON bounty_requests(user_id);
CREATE INDEX idx_skills_user_id ON skills(user_id);
CREATE INDEX idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_conversation_id_created_at ON messages(conversation_id, created_at);

-- Optional: Seed a default test profile if the auth user exists
DO $$
DECLARE
    test_user uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = test_user) THEN
        INSERT INTO profiles (id, username, email, about, phone, balance)
    VALUES (test_user, '@jon_Doe', 'test@example.com', '', '+998 90 943 32 00', 100.00)
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;

-- BountyExpo Database Schema
-- This script creates the necessary tables for the BountyExpo application

-- End of schema