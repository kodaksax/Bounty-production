"use client"

import { Button } from "components/ui/button"
import { useState } from "react"
import { View, Text, TouchableOpacity, ScrollView } from "react-native"

export function DatabaseInitializer({ onInitialized }: { onInitialized: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  return (
    <View className="fixed inset-0 bg-emerald-600 flex flex-col items-center justify-center p-6 z-50">
      <View className="bg-emerald-700 rounded-lg p-6 w-full max-w-md">
        <Text className="text-xl font-bold text-white mb-4">Database Setup Required</Text>

        <Text className="text-emerald-100 mb-6">
          The database tables required for this application don't exist yet. Let's create them using SQL.
        </Text>

        {error && (
          <View className="bg-red-500/20 border border-red-500 rounded-md p-3 mb-4 text-white">
            <Text className="font-medium">Error:</Text>
            <Text className="text-sm">{error}</Text>
          </View>
        )}

        {log.length > 0 && (
          <View className="bg-black/30 rounded-md p-3 mb-4 text-emerald-100 max-h-40 overflow-y-auto">
            <Text className="font-medium mb-2">Log:</Text>
            {log.map((entry, index) => (
              <Text key={index} className="text-xs mb-1">
                {entry}
              </Text>
            ))}
          </View>
        )}

        {/* ANNOTATION: The automatic database initialization via Supabase RPC has been removed.
            This component now instructs the user to manually run the SQL script in their
            Hostinger database management tool (e.g., phpMyAdmin). */}
        <View className="mb-4">
          <Text className="text-emerald-100 mb-2">Please run the following SQL to create the necessary tables:</Text>

          <View className="bg-black/30 rounded-md p-3 text-emerald-100 max-h-60 overflow-y-auto text-xs">
            <Text>{`
-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
 id UUID PRIMARY KEY,
 username TEXT UNIQUE NOT NULL,
 avatar_url TEXT,
 about TEXT,
 phone TEXT,
 balance DECIMAL(10, 2) DEFAULT 40.00,
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create bounties table
CREATE TABLE IF NOT EXISTS bounties (
 id SERIAL PRIMARY KEY,
 title TEXT NOT NULL,
 description TEXT,
 amount DECIMAL(10, 2) DEFAULT 0,
 is_for_honor BOOLEAN DEFAULT FALSE,
 location TEXT,
 timeline TEXT,
 skills_required TEXT,
 user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'archived'))
);

-- Create skills table
CREATE TABLE IF NOT EXISTS skills (
 id SERIAL PRIMARY KEY,
 user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
 icon TEXT NOT NULL,
 text TEXT NOT NULL,
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create bounty_requests table
CREATE TABLE IF NOT EXISTS bounty_requests (
 id SERIAL PRIMARY KEY,
 bounty_id INTEGER REFERENCES bounties(id) ON DELETE CASCADE,
 user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
 status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- IMPORTANT: Always insert the default user first to avoid foreign key constraints
INSERT INTO profiles (id, username, avatar_url, about, phone, balance)
VALUES 
 ('00000000-0000-0000-0000-000000000001', '@Jon_Doe', '/placeholder.svg?height=40&width=40', 'Russian opportunist', '+998 90 943 32 00', 40.00),
 ('00000000-0000-0000-0000-000000000002', '@MtnOlympus', '/placeholder.svg?height=40&width=40', 'Delivery specialist', '+1 555 123 4567', 75.50),
 ('00000000-0000-0000-0000-000000000003', '@CryptoKing', '/placeholder.svg?height=40&width=40', 'Crypto enthusiast', '+1 555 987 6543', 120.25)
ON CONFLICT (id) DO NOTHING;

-- Insert sample skills if not exists
INSERT INTO skills (user_id, icon, text)
VALUES 
 ('00000000-0000-0000-0000-000000000001', 'code', 'Knows English, Spanish'),
 ('00000000-0000-0000-0000-000000000001', 'target', 'Private Investigator Certification'),
 ('00000000-0000-0000-0000-000000000001', 'heart', 'Joined December 28th 2024'),
 ('00000000-0000-0000-0000-000000000002', 'globe', 'Delivery Expert'),
 ('00000000-0000-0000-0000-000000000003', 'code', 'Blockchain Developer')
ON CONFLICT DO NOTHING;

-- Insert sample bounties if not exists
INSERT INTO bounties (title, description, amount, location, timeline, skills_required, user_id, status)
VALUES 
 ('Mow My lawn!!!', 'I need someone to mow my lawn. The yard is approximately 1/4 acre with some slopes. I have a lawn mower you can use, or you can bring your own equipment.', 60.00, 'Seattle, WA', 'This weekend', 'Lawn care, Physical labor', '00000000-0000-0000-0000-000000000001', 'open'),
 ('Delivering a Package', 'I need a package delivered from my home to an office downtown. The package is small (about the size of a shoebox) and weighs less than 5 pounds.', 60.00, 'Portland, OR', 'Next Monday', 'Reliable, Transportation', '00000000-0000-0000-0000-000000000002', 'open'),
 ('Find my fathers murderer', 'I''m looking for someone with investigative skills to help me gather information about a cold case. This requires discretion and attention to detail.', 500.00, 'Chicago, IL', 'Ongoing', 'Investigation, Research', '00000000-0000-0000-0000-000000000001', 'open'),
 ('Help setting up crypto wallet', 'I need assistance setting up a secure cryptocurrency wallet and transferring my assets.', 45.00, 'Remote', 'ASAP', 'Cryptocurrency, Security', '00000000-0000-0000-0000-000000000003', 'open'),
 ('Give me life advice', 'Looking for someone to provide life guidance and mentorship.', 20.00, 'Virtual Meeting', 'Flexible', 'Wisdom, Communication', '00000000-0000-0000-0000-000000000001', 'in_progress')
ON CONFLICT DO NOTHING;

-- Insert sample bounty requests
INSERT INTO bounty_requests (bounty_id, user_id, status)
SELECT 
 b.id, 
 CASE 
   WHEN b.title = 'Mow My lawn!!!' THEN '00000000-0000-0000-0000-000000000002'
   WHEN b.title = 'Delivering a Package' THEN '00000000-0000-0000-0000-000000000001'
   WHEN b.title = 'Find my fathers murderer' THEN '00000000-0000-0000-0000-000000000003'
   WHEN b.title = 'Help setting up crypto wallet' THEN '00000000-0000-0000-0000-000000000001'
   ELSE '00000000-0000-0000-0000-000000000001'
 END,
 CASE 
   WHEN b.title = 'Find my fathers murderer' THEN 'accepted'
   ELSE 'pending'
 END
FROM bounties b
WHERE b.title IN ('Mow My lawn!!!', 'Delivering a Package', 'Find my fathers murderer', 'Help setting up crypto wallet')
ON CONFLICT DO NOTHING;
            `}</Text>
          </View>
        </View>

        <Button onPress={onInitialized} className="w-full bg-emerald-500 hover:bg-emerald-400 text-white">
          I've Run the SQL
        </Button>
      </View>
    </View>
  )
}
