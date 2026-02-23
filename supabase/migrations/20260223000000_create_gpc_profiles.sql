-- Create gpc_profiles table for user profiles with public usernames
CREATE TABLE gpc_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT gpc_profiles_user_id_unique UNIQUE (user_id),
  CONSTRAINT gpc_profiles_username_unique UNIQUE (username),
  CONSTRAINT gpc_profiles_username_format CHECK (username ~ '^[a-z0-9][a-z0-9_-]{2,29}$')
);

-- Index for fast username lookups
CREATE INDEX idx_gpc_profiles_username ON gpc_profiles (username);

-- Enable RLS
ALTER TABLE gpc_profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can view profiles (public profile pages)
CREATE POLICY "Public profiles are viewable by everyone"
  ON gpc_profiles FOR SELECT
  USING (true);

-- Users can insert their own profile
CREATE POLICY "Users can create their own profile"
  ON gpc_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own profile
CREATE POLICY "Users can update their own profile"
  ON gpc_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
