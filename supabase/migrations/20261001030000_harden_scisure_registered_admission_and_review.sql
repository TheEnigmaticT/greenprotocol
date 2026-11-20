-- Registered entitlement counts must survive raw SciSure lineage expiry without
-- retaining a user identifier. Review writes are a single server-only CAS.
CREATE TABLE gpc_registered_analysis_quota_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_scope_hash TEXT NOT NULL CHECK (user_scope_hash ~ '^[a-f0-9]{64}$'),
  admission_key TEXT NOT NULL UNIQUE CHECK (admission_key ~ '^[A-Za-z0-9._:-]{1,200}$'),
  analysis_id UUID REFERENCES gpc_analyses(id) ON DELETE SET NULL,
  analysis_run_id UUID REFERENCES gpc_analysis_runs(id) ON DELETE SET NULL,
  job_id UUID REFERENCES gpc_scisure_jobs(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'running', 'completed', 'failed', 'uncertain')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gpc_registered_analysis_quota_ledger_scope_state_idx
  ON gpc_registered_analysis_quota_ledger(user_scope_hash, state);

-- Preserve historical completed analyses and in-flight run admissions once.
INSERT INTO gpc_registered_analysis_quota_ledger(user_scope_hash, admission_key, analysis_id, state)
SELECT encode(digest('user:' || a.user_id::text, 'sha256'), 'hex'), 'legacy-analysis:' || a.id::text, a.id, 'completed'
FROM gpc_analyses a
ON CONFLICT (admission_key) DO NOTHING;

INSERT INTO gpc_registered_analysis_quota_ledger(user_scope_hash, admission_key, analysis_run_id, state)
SELECT encode(digest('user:' || r.user_id::text, 'sha256'), 'hex'), 'legacy-run:' || r.id::text, r.id,
  CASE r.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'running' END
FROM gpc_analysis_runs r
WHERE r.analysis_id IS NULL
ON CONFLICT (admission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION gpc_sync_registered_quota_run_state()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE gpc_registered_analysis_quota_ledger
  SET state = CASE NEW.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'running' END,
      updated_at = now()
  WHERE analysis_run_id = NEW.id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gpc_registered_quota_run_state ON gpc_analysis_runs;
CREATE TRIGGER gpc_registered_quota_run_state
  AFTER UPDATE OF status ON gpc_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION gpc_sync_registered_quota_run_state();

CREATE OR REPLACE FUNCTION gpc_reserve_registered_analysis_run(p_user_id UUID, p_limit INTEGER, p_run_source TEXT DEFAULT 'human')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_scope TEXT := 'user:' || p_user_id::TEXT; v_scope_hash TEXT := encode(digest('user:' || p_user_id::TEXT, 'sha256'), 'hex'); v_used INTEGER; v_run UUID;
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
    v_scope_hash := encode(digest('user:' || v_user::text, 'sha256'), 'hex');
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

CREATE OR REPLACE FUNCTION gpc_complete_scisure_job(p_job_id UUID,p_lease_token UUID,p_analysis_id UUID,p_analysis_run_id UUID,p_result JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE gpc_scisure_jobs SET status='completed',analysis_id=p_analysis_id,analysis_run_id=p_analysis_run_id,result=p_result,completed_at=now(),lease_expires_at=NULL,lease_token=NULL
    WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>now();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE gpc_scisure_quota_reservations SET state='completed',updated_at=now() WHERE job_id=p_job_id;
  UPDATE gpc_registered_analysis_quota_ledger SET state='completed',updated_at=now() WHERE job_id=p_job_id;
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
  UPDATE gpc_registered_analysis_quota_ledger SET state=CASE WHEN p_status='uncertain' THEN 'uncertain' ELSE 'failed' END,updated_at=now() WHERE job_id=p_job_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION gpc_record_scisure_review_decision(
  p_snapshot_id UUID, p_principal_id UUID, p_reviewer_user_id UUID, p_recommendation_id TEXT,
  p_decision TEXT, p_source_hash TEXT, p_analysis_revision INTEGER
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job_id UUID; v_result JSONB; v_source JSONB; v_revision INTEGER;
BEGIN
  IF p_decision NOT IN ('approved_for_experiment','rejected') OR p_recommendation_id !~ '^[A-Za-z0-9._:-]{1,160}$' OR p_source_hash !~ '^[a-f0-9]{64}$' OR p_analysis_revision < 0 THEN RETURN false; END IF;
  SELECT j.id,a.analysis_result,s.source,a.revision_number INTO v_job_id,v_result,v_source,v_revision
    FROM gpc_scisure_jobs j
    JOIN gpc_scisure_principals p ON p.id=j.principal_id
    JOIN gpc_external_source_snapshots s ON s.id=j.snapshot_id
    JOIN gpc_analyses a ON a.id=j.analysis_id
    WHERE j.snapshot_id=p_snapshot_id AND j.principal_id=p_principal_id AND j.status='completed'
      AND p.kind='registered' AND p.user_id=p_reviewer_user_id AND s.source_hash=p_source_hash
    FOR UPDATE OF j,a;
  IF NOT FOUND OR v_revision<>p_analysis_revision THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_result->'recommendations','[]'::jsonb)) r
    WHERE r->>'id'=p_recommendation_id AND r->>'cardKind'='swap'
      AND r#>>'{evidenceAssessment,eligibleForApplication}'='true'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_source->'selection','[]'::jsonb)) sel
        WHERE sel ? 'stepId' AND (sel->>'order') ~ '^[0-9]+$' AND r->>'stepNumber' ~ '^[0-9]+$'
          AND (sel->>'order')::integer=(r->>'stepNumber')::integer
      )
  ) THEN RETURN false; END IF;
  INSERT INTO gpc_scisure_review_decisions(job_id,recommendation_id,reviewer_user_id,decision)
    VALUES(v_job_id,p_recommendation_id,p_reviewer_user_id,p_decision)
  ON CONFLICT (job_id,recommendation_id) DO UPDATE
    SET reviewer_user_id=EXCLUDED.reviewer_user_id, reviewer_principal_id=NULL, decision=EXCLUDED.decision, created_at=now();
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION gpc_record_scisure_guest_review_decision(
  p_snapshot_id UUID, p_principal_id UUID, p_subject_id UUID, p_recommendation_id TEXT,
  p_decision TEXT, p_source_hash TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job_id UUID; v_result JSONB; v_source JSONB;
BEGIN
  IF p_decision NOT IN ('approved_for_experiment','rejected') OR p_recommendation_id !~ '^[A-Za-z0-9._:-]{1,160}$' OR p_source_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  SELECT j.id,j.result,s.source INTO v_job_id,v_result,v_source
    FROM gpc_scisure_jobs j
    JOIN gpc_scisure_principals p ON p.id=j.principal_id
    JOIN gpc_external_source_snapshots s ON s.id=j.snapshot_id
    WHERE j.snapshot_id=p_snapshot_id AND j.principal_id=p_principal_id AND j.status='completed'
      AND p.kind='guest' AND p.guest_subject_id=p_subject_id AND s.source_hash=p_source_hash
    FOR UPDATE OF j;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_result->'recommendations','[]'::jsonb)) r
    WHERE r->>'id'=p_recommendation_id AND r->>'cardKind'='swap'
      AND r#>>'{evidenceAssessment,eligibleForApplication}'='true'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_source->'selection','[]'::jsonb)) sel
        WHERE sel ? 'stepId' AND (sel->>'order') ~ '^[0-9]+$' AND r->>'stepNumber' ~ '^[0-9]+$'
          AND (sel->>'order')::integer=(r->>'stepNumber')::integer
      )
  ) THEN RETURN false; END IF;
  INSERT INTO gpc_scisure_review_decisions(job_id,recommendation_id,reviewer_principal_id,decision)
    VALUES(v_job_id,p_recommendation_id,p_principal_id,p_decision)
  ON CONFLICT (job_id,recommendation_id) DO UPDATE
    SET reviewer_user_id=NULL, reviewer_principal_id=EXCLUDED.reviewer_principal_id, decision=EXCLUDED.decision, created_at=now();
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION gpc_sync_registered_quota_run_state() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_record_scisure_review_decision(UUID,UUID,UUID,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_record_scisure_guest_review_decision(UUID,UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_reserve_scisure_job(UUID,UUID,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_reserve_registered_analysis_run(UUID,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_complete_scisure_job(UUID,UUID,UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_fail_scisure_job(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_record_scisure_review_decision(UUID,UUID,UUID,TEXT,TEXT,TEXT,INTEGER),gpc_record_scisure_guest_review_decision(UUID,UUID,UUID,TEXT,TEXT,TEXT),gpc_reserve_scisure_job(UUID,UUID,TEXT,INTEGER),gpc_reserve_registered_analysis_run(UUID,INTEGER,TEXT),gpc_complete_scisure_job(UUID,UUID,UUID,UUID,JSONB),gpc_fail_scisure_job(UUID,UUID,TEXT,TEXT) TO service_role;
