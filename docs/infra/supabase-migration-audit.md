# Audit: Supabase Migration to Dedicated Project

## Tables to Migrate
- `gpc_analyses`: Stores reaction protocols and AI analysis results.
- `gpc_profiles`: Stores user usernames and display names.

## Configurations
- **RLS Policies:** 
    - `gpc_analyses`: View/Insert for `auth.uid() = user_id`.
    - `gpc_profiles`: View public, Insert/Update for `auth.uid() = user_id`.
- **Auth Config:** Email confirmation, Google OAuth.
- **Project Link:** Currently on `xwcviwzwedljuuyfduso` (shared workspace).

## Migration Plan
1. **Target:** Create new Supabase project "greenchemistry-ai-prod".
2. **Schema Export:** Dump current `gpc_` tables and related RLS.
3. **Data Export:** Export current records from shared project.
4. **Environment:** Update `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel.
5. **DNS/Auth:** Update OAuth redirect URLs in Google Cloud Console.

## Forensics: Analysis Traces
- Backlog item `Audit: Pipeline process trace` suggests a new table `gpc_analysis_traces`. This should be created in the new project.
