-- BountyExpo Database Schema
-- This script creates the necessary tables for the BountyExpo application

-- Users/Profiles table
CREATE TABLE IF NOT EXISTS profiles (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    avatar_url TEXT,
    about TEXT,
    phone VARCHAR(50),
    balance DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Bounties table
CREATE TABLE IF NOT EXISTS bounties (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    amount DECIMAL(10, 2) DEFAULT 0.00,
    is_for_honor BOOLEAN DEFAULT FALSE,
    location TEXT,
    timeline VARCHAR(255),
    skills_required TEXT,
    user_id VARCHAR(36) NOT NULL,
    status ENUM('open', 'in_progress', 'completed', 'archived') DEFAULT 'open',
    work_type ENUM('online', 'in_person') DEFAULT 'online',
    is_time_sensitive BOOLEAN DEFAULT FALSE,
    deadline TIMESTAMP NULL,
    attachments_json TEXT, -- JSON string of attachment metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Skills table
CREATE TABLE IF NOT EXISTS skills (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    icon VARCHAR(255),
    text VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Bounty Requests table
CREATE TABLE IF NOT EXISTS bounty_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bounty_id INT NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (bounty_id) REFERENCES bounties(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    UNIQUE KEY unique_bounty_user (bounty_id, user_id)
);

-- Conversations table (for messaging)
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(36) PRIMARY KEY,
    bounty_id INT,
    is_group BOOLEAN DEFAULT FALSE,
    name VARCHAR(255) NOT NULL,
    avatar TEXT,
    last_message TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bounty_id) REFERENCES bounties(id) ON DELETE SET NULL
);

-- Conversation participants
CREATE TABLE IF NOT EXISTS conversation_participants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    UNIQUE KEY unique_conversation_user (conversation_id, user_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Wallet transactions table
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    type ENUM('escrow', 'release', 'refund', 'deposit', 'withdrawal') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    bounty_id INT,
    description TEXT,
    status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (bounty_id) REFERENCES bounties(id) ON DELETE SET NULL
);

-- Create indexes for better performance
CREATE INDEX idx_bounties_user_id ON bounties(user_id);
CREATE INDEX idx_bounties_status ON bounties(status);
CREATE INDEX idx_bounties_created_at ON bounties(created_at);
CREATE INDEX idx_bounty_requests_bounty_id ON bounty_requests(bounty_id);
CREATE INDEX idx_bounty_requests_user_id ON bounty_requests(user_id);
CREATE INDEX idx_skills_user_id ON skills(user_id);
CREATE INDEX idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);

-- Insert a default test user
INSERT INTO profiles (id, username, email, about, phone, balance) 
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '@jon_Doe', 
    'test@example.com',
    'Russian opportunist',
    '+998 90 943 32 00',
    100.00
) ON DUPLICATE KEY UPDATE username = username;