-- BountyExpo Database Initialization Script
-- This file is automatically executed when PostgreSQL container starts

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users/profiles table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    handle VARCHAR(50) UNIQUE NOT NULL,
    stripe_account_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create bounties table
CREATE TABLE IF NOT EXISTS bounties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    amount INTEGER, -- Amount in cents
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'archived')),
    poster_id UUID REFERENCES users(id) ON DELETE CASCADE,
    hunter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create outbox events table (for event sourcing)
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_poster_id ON bounties(poster_id);
CREATE INDEX IF NOT EXISTS idx_bounties_hunter_id ON bounties(hunter_id);
CREATE INDEX IF NOT EXISTS idx_outbox_events_processed ON outbox_events(processed_at);
CREATE INDEX IF NOT EXISTS idx_outbox_events_created ON outbox_events(created_at);

-- Insert demo data for development
INSERT INTO users (id, handle, stripe_account_id) VALUES 
('00000000-0000-0000-0000-000000000001', '@demo_poster', NULL),
('00000000-0000-0000-0000-000000000002', '@demo_hunter', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO bounties (id, title, description, amount, poster_id, status) VALUES 
('10000000-0000-0000-0000-000000000001', 'Help with React Native Setup', 'Need assistance setting up a React Native development environment', 5000, '00000000-0000-0000-0000-000000000001', 'open'),
('10000000-0000-0000-0000-000000000002', 'Design Mobile App Icon', 'Looking for a creative designer to create an app icon for a productivity app', 7500, '00000000-0000-0000-0000-000000000001', 'open')
ON CONFLICT (id) DO NOTHING;

-- Success message
SELECT 'BountyExpo database initialized successfully!' as status;