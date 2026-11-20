-- SciSure bridge storage is server-owned. Browser roles get no RPC execution grants.
CREATE TABLE gpc_scisure_principals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('registered', 'guest')),
  guest_token_hash TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'registered' AND user_id IS NOT NULL AND guest_token_hash IS NULL) OR (kind = 'guest' AND user_id IS NULL AND guest_token_hash IS NOT NULL))
);

CREATE TABLE gpc_scisure_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES gpc_scisure_principals(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  allowed_origin TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  credential_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gpc_external_source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES gpc_scisure_principals(id) ON DELETE RESTRICT,
  connection_id UUID NOT NULL REFERENCES gpc_scisure_connections(id) ON DELETE RESTRICT,
  source_hash TEXT NOT NULL,
  source JSONB NOT NULL,
  protocol_text TEXT NOT NULL,
  delivery_email TEXT,
  delivery_consent BOOLEAN NOT NULL DEFAULT false,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  consented_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(connection_id, source_hash)
);

CREATE TABLE gpc_scisure_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES gpc_scisure_principals(id) ON DELETE RESTRICT,
  snapshot_id UUID NOT NULL REFERENCES gpc_external_source_snapshots(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'uncertain')),
  analysis_id UUID REFERENCES gpc_analyses(id) ON DELETE SET NULL,
  analysis_run_id UUID REFERENCES gpc_analysis_runs(id) ON DELETE SET NULL,
  result JSONB,
  error_code TEXT,
  leased_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  lease_token UUID,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(principal_id, idempotency_key)
);

-- For guests this is the non-PII entitlement ledger retained after raw lineage deletion.
CREATE TABLE gpc_scisure_quota_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key TEXT NOT NULL,
  job_id UUID UNIQUE REFERENCES gpc_scisure_jobs(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'running', 'released', 'completed', 'uncertain')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gpc_scisure_review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES gpc_scisure_jobs(id) ON DELETE CASCADE,
  recommendation_id TEXT NOT NULL,
  reviewer_principal_id UUID REFERENCES gpc_scisure_principals(id) ON DELETE RESTRICT,
  reviewer_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved_for_experiment', 'rejected')),
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((reviewer_principal_id IS NOT NULL)::integer + (reviewer_user_id IS NOT NULL)::integer = 1),
  UNIQUE(job_id, recommendation_id)
);

CREATE TABLE gpc_scisure_email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES gpc_external_source_snapshots(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('delivery', 'marketing')),
  address TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending_configuration', 'queued', 'sent', 'suppressed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id, purpose)
);

CREATE INDEX gpc_scisure_connections_principal_idx ON gpc_scisure_connections(principal_id);
CREATE INDEX gpc_scisure_snapshots_principal_idx ON gpc_external_source_snapshots(principal_id);
CREATE INDEX gpc_scisure_jobs_status_idx ON gpc_scisure_jobs(status, created_at);
CREATE INDEX gpc_scisure_quota_scope_idx ON gpc_scisure_quota_reservations(scope_key, state);

-- SciSure runs are represented as a distinct source, without widening browser grants.
ALTER TABLE gpc_analysis_runs DROP CONSTRAINT IF EXISTS gpc_analysis_runs_run_source_check;
ALTER TABLE gpc_analysis_runs ADD CONSTRAINT gpc_analysis_runs_run_source_check CHECK (run_source IN ('human', 'sentinel', 'scisure'));

CREATE OR REPLACE FUNCTION gpc_reserve_scisure_job(
  p_principal_id UUID, p_snapshot_id UUID, p_idempotency_key TEXT, p_limit INTEGER
) RETURNS TABLE(job_id UUID, replayed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scope TEXT; v_user UUID; v_kind TEXT; v_existing UUID; v_used INTEGER;
BEGIN
  IF p_limit < 1 OR p_limit > 100000 OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' THEN RAISE EXCEPTION 'invalid quota reservation'; END IF;
  SELECT CASE WHEN kind = 'registered' THEN 'user:' || user_id::TEXT ELSE 'guest:' || guest_token_hash END, user_id, kind
    INTO v_scope, v_user, v_kind FROM gpc_scisure_principals WHERE id = p_principal_id AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());
  IF v_scope IS NULL THEN RAISE EXCEPTION 'principal unavailable'; END IF;
  -- Do not trust a service caller to keep IDs coherent: the source must belong to this principal and connection.
  PERFORM 1 FROM gpc_external_source_snapshots s JOIN gpc_scisure_connections c ON c.id=s.connection_id
    WHERE s.id=p_snapshot_id AND s.principal_id=p_principal_id AND c.principal_id=p_principal_id AND s.expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot is not owned by principal'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope, 0));
  SELECT id INTO v_existing FROM gpc_scisure_jobs WHERE principal_id=p_principal_id AND idempotency_key=p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN QUERY SELECT v_existing, true; RETURN; END IF;
  SELECT count(*) INTO v_used FROM gpc_scisure_quota_reservations
    WHERE scope_key=v_scope AND state IN ('reserved','running','uncertain')
       OR (scope_key=v_scope AND v_kind='guest' AND state='completed');
  IF v_kind='guest' AND EXISTS (SELECT 1 FROM gpc_scisure_quota_reservations WHERE scope_key=v_scope AND state IN ('reserved','running','uncertain')) THEN
    RAISE EXCEPTION 'guest already has an active analysis';
  END IF;
  IF v_user IS NOT NULL THEN
    v_used := v_used + (SELECT count(*) FROM gpc_analyses WHERE user_id=v_user)
      + (SELECT count(*) FROM gpc_analysis_runs WHERE user_id=v_user AND status='running');
  END IF;
  IF v_used >= p_limit THEN RAISE EXCEPTION 'analysis quota exhausted'; END IF;
  INSERT INTO gpc_scisure_jobs(principal_id,snapshot_id,idempotency_key,status,expires_at)
    VALUES (p_principal_id,p_snapshot_id,p_idempotency_key,'queued',now()+interval '90 days') RETURNING id INTO v_existing;
  INSERT INTO gpc_scisure_quota_reservations(scope_key,job_id,state) VALUES(v_scope,v_existing,'reserved');
  RETURN QUERY SELECT v_existing,false;
END $$;

-- Ordinary browser admissions share the exact registered principal lock and active counts.
CREATE OR REPLACE FUNCTION gpc_reserve_registered_analysis_run(p_user_id UUID, p_limit INTEGER, p_run_source TEXT DEFAULT 'human')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scope TEXT := 'user:' || p_user_id::TEXT; v_used INTEGER; v_run UUID;
BEGIN
  IF p_limit < 1 OR p_limit > 100000 OR p_run_source NOT IN ('human','sentinel') THEN RAISE EXCEPTION 'invalid analysis reservation'; END IF;
  PERFORM 1 FROM auth.users WHERE id=p_user_id; IF NOT FOUND THEN RAISE EXCEPTION 'user unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope,0));
  SELECT count(*) INTO v_used FROM gpc_analyses WHERE user_id=p_user_id;
  -- A SciSure reservation owns its linked running audit row. Count it once via
  -- the reservation ledger; otherwise one provider call can consume two slots.
  v_used := v_used + (SELECT count(*) FROM gpc_analysis_runs r WHERE r.user_id=p_user_id AND r.status='running'
    AND NOT EXISTS (SELECT 1 FROM gpc_scisure_jobs j WHERE j.analysis_run_id=r.id));
  v_used := v_used + (SELECT count(*) FROM gpc_scisure_quota_reservations WHERE scope_key=v_scope AND state IN ('reserved','running','uncertain'));
  IF v_used >= p_limit THEN RAISE EXCEPTION 'analysis quota exhausted'; END IF;
  INSERT INTO gpc_analysis_runs(user_id,status,run_source) VALUES(p_user_id,'running',p_run_source) RETURNING id INTO v_run;
  RETURN v_run;
END $$;

-- A stale provider call is uncertain, never a candidate for automatic provider re-execution.
CREATE OR REPLACE FUNCTION gpc_lease_scisure_job(p_lease_seconds INTEGER DEFAULT 900)
RETURNS TABLE(job_id UUID, principal_id UUID, principal_kind TEXT, owner_user_id UUID, snapshot_id UUID, source_hash TEXT, protocol_text TEXT, lease_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job UUID; v_token UUID;
BEGIN
  IF p_lease_seconds < 900 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  WITH stale AS (
    UPDATE gpc_scisure_jobs SET status='uncertain', error_code='lease_expired_unknown_outcome', completed_at=now(), lease_expires_at=NULL, lease_token=NULL
      WHERE status='running' AND lease_expires_at < now() AND expires_at > now() RETURNING id
  ) UPDATE gpc_scisure_quota_reservations q SET state='uncertain', updated_at=now() FROM stale WHERE q.job_id=stale.id;
  SELECT id INTO v_job FROM gpc_scisure_jobs WHERE status='queued' AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_job IS NULL THEN RETURN; END IF;
  v_token := gen_random_uuid();
  UPDATE gpc_scisure_jobs SET status='running',leased_at=now(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),lease_token=v_token WHERE id=v_job;
  UPDATE gpc_scisure_quota_reservations SET state='running',updated_at=now() WHERE job_id=v_job;
  RETURN QUERY SELECT j.id,j.principal_id,p.kind,c.owner_user_id,j.snapshot_id,s.source_hash,s.protocol_text,j.lease_token
    FROM gpc_scisure_jobs j JOIN gpc_scisure_principals p ON p.id=j.principal_id JOIN gpc_external_source_snapshots s ON s.id=j.snapshot_id
    JOIN gpc_scisure_connections c ON c.id=s.connection_id WHERE j.id=v_job;
END $$;

CREATE OR REPLACE FUNCTION gpc_heartbeat_scisure_job(p_job_id UUID,p_lease_token UUID,p_lease_seconds INTEGER DEFAULT 900)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_lease_seconds < 900 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  UPDATE gpc_scisure_jobs SET lease_expires_at=now()+make_interval(secs=>p_lease_seconds)
    WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>now();
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION gpc_complete_scisure_job(p_job_id UUID,p_lease_token UUID,p_analysis_id UUID,p_analysis_run_id UUID,p_result JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE gpc_scisure_jobs SET status='completed',analysis_id=p_analysis_id,analysis_run_id=p_analysis_run_id,result=p_result,completed_at=now(),lease_expires_at=NULL,lease_token=NULL
    WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>now();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE gpc_scisure_quota_reservations SET state='completed',updated_at=now() WHERE job_id=p_job_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION gpc_fail_scisure_job(p_job_id UUID,p_lease_token UUID,p_status TEXT,p_error_code TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_status NOT IN ('failed','uncertain') THEN RAISE EXCEPTION 'invalid final status'; END IF;
  UPDATE gpc_scisure_jobs SET status=p_status,error_code=left(p_error_code,160),completed_at=now(),lease_expires_at=NULL,lease_token=NULL
    WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>now();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE gpc_scisure_quota_reservations SET state=CASE WHEN p_status='uncertain' THEN 'uncertain' ELSE 'released' END,updated_at=now() WHERE job_id=p_job_id;
  RETURN true;
END $$;

-- Delete all raw content before restrictive snapshot/connection/principal rows. Retain guest quota ledger only.
CREATE OR REPLACE FUNCTION gpc_purge_expired_scisure_lineage()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM gpc_analysis_traces t USING gpc_scisure_jobs j WHERE j.expires_at<=now() AND (t.analysis_run_id=j.analysis_run_id OR t.analysis_id=j.analysis_id);
  DELETE FROM gpc_dedup_log d USING gpc_scisure_jobs j WHERE j.expires_at<=now() AND (d.analysis_run_id=j.analysis_run_id OR d.analysis_id=j.analysis_id);
  -- The bridge worker runs without a canonical-scoring Supabase context and does not
  -- create gpc_canonical_scoring_snapshots. Never delete account-wide snapshots here:
  -- those belong to independent browser analyses, not this admitted source lineage.
  DELETE FROM gpc_analysis_runs r USING gpc_scisure_jobs j WHERE j.expires_at<=now() AND r.id=j.analysis_run_id;
  DELETE FROM gpc_analyses a USING gpc_scisure_jobs j WHERE j.expires_at<=now() AND a.id=j.analysis_id;
  DELETE FROM gpc_scisure_email_events e USING gpc_external_source_snapshots s WHERE s.expires_at<=now() AND e.snapshot_id=s.id;
  DELETE FROM gpc_scisure_jobs WHERE expires_at<=now(); GET DIAGNOSTICS v_count=ROW_COUNT;
  DELETE FROM gpc_external_source_snapshots WHERE expires_at<=now();
  -- A 10-minute bridge credential cannot outlive its snapshot, but its row must remain as a FK parent until raw retention ends.
  UPDATE gpc_scisure_connections SET revoked_at=COALESCE(revoked_at,now()), credential_hash='revoked', nonce_hash='revoked'
    WHERE expires_at<=now() AND (credential_hash<>'revoked' OR nonce_hash<>'revoked');
  DELETE FROM gpc_scisure_connections c WHERE c.expires_at<=now() AND NOT EXISTS(SELECT 1 FROM gpc_external_source_snapshots s WHERE s.connection_id=c.id);
  DELETE FROM gpc_scisure_principals p WHERE p.kind='guest' AND p.expires_at<=now() AND NOT EXISTS(SELECT 1 FROM gpc_external_source_snapshots s WHERE s.principal_id=p.id) AND NOT EXISTS(SELECT 1 FROM gpc_scisure_jobs j WHERE j.principal_id=p.id);
  RETURN v_count;
END $$;

ALTER TABLE gpc_scisure_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_external_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_email_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION gpc_reserve_scisure_job(UUID,UUID,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_reserve_registered_analysis_run(UUID,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_lease_scisure_job(INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_heartbeat_scisure_job(UUID,UUID,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_complete_scisure_job(UUID,UUID,UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_fail_scisure_job(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_purge_expired_scisure_lineage() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_reserve_scisure_job(UUID,UUID,TEXT,INTEGER),gpc_reserve_registered_analysis_run(UUID,INTEGER,TEXT),gpc_lease_scisure_job(INTEGER),gpc_heartbeat_scisure_job(UUID,UUID,INTEGER),gpc_complete_scisure_job(UUID,UUID,UUID,UUID,JSONB),gpc_fail_scisure_job(UUID,UUID,TEXT,TEXT),gpc_purge_expired_scisure_lineage() TO service_role;
-- Deliberately no client policies: routes and worker use the service role only.
