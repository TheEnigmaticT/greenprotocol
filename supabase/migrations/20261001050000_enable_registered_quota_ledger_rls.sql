-- Follow-up hardening: preserve the immutable source record for the prior migration.
-- The server-owned registered quota ledger must never permit browser-role access.
ALTER TABLE gpc_registered_analysis_quota_ledger ENABLE ROW LEVEL SECURITY;
