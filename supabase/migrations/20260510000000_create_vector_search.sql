CREATE EXTENSION IF NOT EXISTS vector;

-- Literature precendent table for grounded recommendations
CREATE TABLE IF NOT EXISTS literature_precedents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT,
  journal TEXT,
  year INTEGER,
  doi TEXT UNIQUE,
  url TEXT,
  abstract TEXT,
  content_snippet TEXT, -- Specific relevant passage
  embedding VECTOR(1536), -- For semantic search
  
  -- Metadata for filtering/grounding
  chemical_subjects TEXT[], -- List of chemicals mentioned (canonical names)
  principles_addressed INTEGER[], -- Which of the 12 principles this covers
  hazard_types TEXT[], -- e.g. ["carcinogen", "reprotoxic", "solvent_replacement"]
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for vector search
CREATE INDEX ON literature_precedents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Function for semantic search
CREATE OR REPLACE FUNCTION match_literature_precedents (
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count INT,
  filter_principles INTEGER[] DEFAULT '{}',
  filter_chemicals TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  authors TEXT,
  journal TEXT,
  year INTEGER,
  doi TEXT,
  url TEXT,
  content_snippet TEXT,
  similarity FLOAT,
  principles_addressed INTEGER[],
  chemical_subjects TEXT[]
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    lp.id,
    lp.title,
    lp.authors,
    lp.journal,
    lp.year,
    lp.doi,
    lp.url,
    lp.content_snippet,
    1 - (lp.embedding <=> query_embedding) AS similarity,
    lp.principles_addressed,
    lp.chemical_subjects
  FROM literature_precedents lp
  WHERE 1 - (lp.embedding <=> query_embedding) > match_threshold
    AND (cardinality(filter_principles) = 0 OR lp.principles_addressed && filter_principles)
    AND (cardinality(filter_chemicals) = 0 OR lp.chemical_subjects && filter_chemicals)
  ORDER BY lp.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
