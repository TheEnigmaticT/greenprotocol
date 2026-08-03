-- Procedure-specific evidence retrieval schema.
-- Apply after enabling pgvector. This intentionally does not replace
-- literature_precedents: one article may have many evidence units.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS literature_source_documents (
  id TEXT PRIMARY KEY,
  doi TEXT,
  title TEXT NOT NULL,
  journal TEXT,
  volume INTEGER,
  year INTEGER,
  source_pdf TEXT,
  text_path TEXT,
  source_checksum TEXT,
  rights_status TEXT,
  document_type TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  tenant_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS literature_evidence_units (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES literature_source_documents(id) ON DELETE CASCADE,
  doi TEXT,
  title TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  section TEXT,
  quote TEXT NOT NULL,
  normalized_claim TEXT,
  evidence_type TEXT,
  signal_groups TEXT[] NOT NULL DEFAULT '{}',
  inputs TEXT[],
  outputs TEXT[],
  operation_type TEXT,
  reagents TEXT[],
  solvents TEXT[],
  catalysts TEXT[],
  conditions JSONB,
  reported_metrics JSONB,
  comparison_target TEXT,
  applicability TEXT,
  limitations TEXT,
  candidate_status TEXT NOT NULL DEFAULT 'candidate_pending_adjudication',
  visibility TEXT NOT NULL DEFAULT 'public',
  tenant_id UUID,
  embedding_model TEXT,
  embedding VECTOR(1536),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS literature_evidence_units_embedding_idx
  ON literature_evidence_units USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS literature_evidence_units_source_idx
  ON literature_evidence_units(source_document_id);
CREATE INDEX IF NOT EXISTS literature_evidence_units_visibility_idx
  ON literature_evidence_units(visibility, tenant_id);

CREATE OR REPLACE FUNCTION match_literature_evidence_units(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.25,
  match_count INT DEFAULT 20,
  requested_visibility TEXT DEFAULT 'public',
  requested_tenant_id UUID DEFAULT NULL,
  filter_signal_groups TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
  id TEXT,
  source_document_id TEXT,
  doi TEXT,
  title TEXT,
  page_start INTEGER,
  page_end INTEGER,
  quote TEXT,
  evidence_type TEXT,
  applicability TEXT,
  limitations TEXT,
  candidate_status TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.id, e.source_document_id, e.doi, e.title, e.page_start, e.page_end,
    e.quote, e.evidence_type, e.applicability, e.limitations,
    e.candidate_status,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM literature_evidence_units e
  WHERE e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) >= match_threshold
    AND (
      (requested_visibility = 'public' AND e.visibility = 'public')
      OR (requested_visibility <> 'public' AND e.visibility = requested_visibility AND e.tenant_id = requested_tenant_id)
    )
    AND (cardinality(filter_signal_groups) = 0 OR e.signal_groups && filter_signal_groups)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;
