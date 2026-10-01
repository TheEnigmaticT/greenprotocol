-- Fix pgcrypto digest() type inference. The previous migration passed the
-- algorithm literal as `unknown`, which caused runtime SQL errors of the form
-- "function digest(text, unknown) does not exist" inside worker-reserved
-- SciSure jobs. Re-assert every digest() call with an explicit ::text cast.
-- This migration only re-defines existing function bodies; it does not change
-- any schema, RLS, or quota semantics.

CREATE OR REPLACE FUNCTION gpc_reserve_registered_analysis_run(p_user_id UUID, p_limit INTEGER, p_run_source TEXT DEFAULT 'human')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_scope TEXT := 'user:' || p_user_id::TEXT; v_scope_hash TEXT := encode(digest('user:' || p_user_id::TEXT, 'sha256'::text), 'hex'); v_used INTEGER; v_run UUID;
BEGIN
  IF p_limit < 1 OR p_limit > 100000 OR p_run_source NOT IN ('human','sentinel') THEN RAISE EXCEPTION 'invalid analysis reservation'; END IF;
  PERFORM 1 FROM auth.users WHERE id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope,0));
  SELECT count(*) INTO v_used FROM gpc_registered_analysis_quota_ledger
    WHERE user_scope_hash=v_scope_hash AND state IN ('reserved','running','completed','uncertain');
  IF v_used >= p_limit THEN RAISE EXCEPTION 'analysis quota exhausted'; END IF;
  INSERT INTO gpc_analysis_runs(user_id,status,run_source) VALUES(p_user_id,'running',p_run_source) RETURNING id INTO v_run;
  INSERT INTO gpc_registered_analysis_quota_ledger(user_scope_hash,admission_key,analysis_run_id,state)
    VALUES(v_scope_hash,'run:' || v_run::text,v_run,'running');
  RETURN v_run;
END $$;

CREATE OR REPLACE FUNCTION gpc_reserve_scisure_job(
  p_principal_id UUID, p_snapshot_id UUID, p_idempotency_key TEXT, p_limit INTEGER
) RETURNS TABLE(job_id UUID, replayed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scope TEXT; v_scope_hash TEXT; v_user UUID; v_kind TEXT; v_existing UUID; v_used INTEGER;
BEGIN
  IF p_limit < 1 OR p_limit > 100000 OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' THEN RAISE EXCEPTION 'invalid quota reservation'; END IF;
  SELECT CASE WHEN kind='registered' THEN 'user:' || user_id::text ELSE 'guest:' || guest_token_hash END, user_id, kind
    INTO v_scope,v_user,v_kind FROM gpc_scisure_principals WHERE id=p_principal_id AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now());
  IF v_scope IS NULL THEN RAISE EXCEPTION 'principal unavailable'; END IF;
  PERFORM 1 FROM gpc_external_source_snapshots s JOIN gpc_scisure_connections c ON c.id=s.connection_id
    WHERE s.id=p_snapshot_id AND s.principal_id=p_principal_id AND c.principal_id=p_principal_id AND s.expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot is not owned by principal'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope,0));
  SELECT id INTO v_existing FROM gpc_scisure_jobs WHERE principal_id=p_principal_id AND idempotency_key=p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN QUERY SELECT v_existing,true; RETURN; END IF;
  IF v_kind='registered' THEN
    v_scope_hash := encode(digest('user:' || v_user::text, 'sha256'::text), 'hex');
    SELECT count(*) INTO v_used FROM gpc_registered_analysis_quota_ledger
      WHERE user_scope_hash=v_scope_hash AND state IN ('reserved','running','completed','uncertain');
  ELSE
    SELECT count(*) INTO v_used FROM gpc_scisure_quota_reservations WHERE scope_key=v_scope AND state IN ('reserved','running','uncertain','completed');
    IF EXISTS (SELECT 1 FROM gpc_scisure_quota_reservations WHERE scope_key=v_scope AND state IN ('reserved','running','uncertain')) THEN RAISE EXCEPTION 'guest already has an active analysis'; END IF;
  END IF;
  IF v_used >= p_limit THEN RAISE EXCEPTION 'analysis quota exhausted'; END IF;
  INSERT INTO gpc_scisure_jobs(principal_id,snapshot_id,idempotency_key,status,expires_at)
    VALUES(p_principal_id,p_snapshot_id,p_idempotency_key,'queued',now()+interval '90 days') RETURNING id INTO v_existing;
  INSERT INTO gpc_scisure_quota_reservations(scope_key,job_id,state) VALUES(v_scope,v_existing,'reserved');
  IF v_kind='registered' THEN
    INSERT INTO gpc_registered_analysis_quota_ledger(user_scope_hash,admission_key,job_id,state)
      VALUES(v_scope_hash,'scisure-job:' || v_existing::text,v_existing,'reserved');
  END IF;
  RETURN QUERY SELECT v_existing,false;
END $$;

-- pgcrypto must be present (declared at the top of the registered bridge
-- migration, but assert here in case the function bodies are applied on a
-- fresh database without that migration).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Re-assert service-only access for the re-defined functions, matching the
-- 20261001030000 migration pattern so a fresh CREATE doesn't reintroduce the
-- default PUBLIC/anon/authenticated grants.
REVOKE ALL ON FUNCTION gpc_reserve_scisure_job(UUID,UUID,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_reserve_registered_analysis_run(UUID,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_reserve_scisure_job(UUID,UUID,TEXT,INTEGER),gpc_reserve_registered_analysis_run(UUID,INTEGER,TEXT) TO service_role;
