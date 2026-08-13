-- Secure the literature / evidence tables.
--
-- These three tables were created WITHOUT row-level security
-- (20260510000000_create_vector_search.sql, 20260731000000_create_literature_evidence_units.sql).
-- Under Supabase defaults, a table in `public` with no RLS is readable AND
-- writable by the `anon` role via PostgREST — and the anon key ships in the
-- browser bundle. That let anyone insert forged "evidence units" whose text is
-- embedded, retrieved by match_literature_evidence_units(), and fed verbatim into
-- every user's scoped chat: a durable prompt-injection channel into a chemistry
-- safety product (or a one-request DELETE of the whole index).
-- See docs/audits/2026-08-13-full-audit.md (Critical #2).
--
-- Posture: the index is public reference literature, so keep it world-readable,
-- but make it WRITE-ONLY via the service role. Runtime retrieval already goes
-- through the service-role admin client (lib/literature-evidence.ts,
-- lib/vector-search.ts), and the service role bypasses RLS, so ingestion and
-- retrieval keep working; only anon/authenticated writes are removed.

-- ── literature_precedents ────────────────────────────────────────────────
ALTER TABLE literature_precedents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "literature_precedents public read" ON literature_precedents;
CREATE POLICY "literature_precedents public read"
  ON literature_precedents FOR SELECT
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON literature_precedents FROM anon, authenticated;

-- ── literature_source_documents ──────────────────────────────────────────
ALTER TABLE literature_source_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "literature_source_documents public read" ON literature_source_documents;
CREATE POLICY "literature_source_documents public read"
  ON literature_source_documents FOR SELECT
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON literature_source_documents FROM anon, authenticated;

-- ── literature_evidence_units ────────────────────────────────────────────
ALTER TABLE literature_evidence_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "literature_evidence_units public read" ON literature_evidence_units;
CREATE POLICY "literature_evidence_units public read"
  ON literature_evidence_units FOR SELECT
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON literature_evidence_units FROM anon, authenticated;
