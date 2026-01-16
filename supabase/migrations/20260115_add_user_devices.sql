-- Create user_devices table for session management
CREATE TABLE IF NOT EXISTS public.user_devices (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    device_name text NOT NULL,
    device_type text DEFAULT 'unknown', -- 'mobile', 'web', 'tablet'
    ip_address text,
    last_active timestamptz DEFAULT now(),
    is_current boolean DEFAULT false, -- Used by client to identify current device record
    fcm_token text,
    created_at timestamptz DEFAULT now(),
    is_active boolean DEFAULT true -- false = revoked
);

-- Enable RLS
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own devices"
    ON public.user_devices FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own devices"
    ON public.user_devices FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own devices"
    ON public.user_devices FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own devices"
    ON public.user_devices FOR DELETE
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_user_devices_user_id ON public.user_devices(user_id);
CREATE INDEX idx_user_devices_last_active ON public.user_devices(last_active);
