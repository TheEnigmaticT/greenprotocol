-- Additive, staging-only migration. Do not apply to production without reviewed interface patches.
-- Guest admission is a server-owned stable subject ledger; it does not enable Supabase anonymous auth.
CREATE TABLE gpc_scisure_guest_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE gpc_scisure_guest_email_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES gpc_scisure_guest_subjects(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gpc_scisure_guest_admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES gpc_scisure_guest_subjects(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gpc_scisure_guest_email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES gpc_scisure_guest_subjects(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('admission', 'recovery')),
  state TEXT NOT NULL CHECK (state IN ('pending_configuration', 'queued', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(subject_id, purpose)
);

CREATE TABLE gpc_scisure_guest_subject_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES gpc_scisure_guest_subjects(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(subject_id, idempotency_key)
);

CREATE TABLE gpc_scisure_guest_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES gpc_scisure_guest_subjects(id) ON DELETE RESTRICT,
  job_id UUID NOT NULL UNIQUE REFERENCES gpc_scisure_jobs(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Parent integration patch: resolve guest principal by guest_subject_id, not a fresh token hash.
ALTER TABLE gpc_scisure_principals ADD COLUMN guest_subject_id UUID REFERENCES gpc_scisure_guest_subjects(id) ON DELETE RESTRICT;
-- Stable guest subjects replace per-token principals. Keep legacy token principals readable only
-- long enough for their existing retained rows; new guest principals must use a subject.
ALTER TABLE gpc_scisure_principals DROP CONSTRAINT gpc_scisure_principals_check;
ALTER TABLE gpc_scisure_principals ADD CONSTRAINT gpc_scisure_principals_check CHECK (
  (kind = 'registered' AND user_id IS NOT NULL AND guest_token_hash IS NULL AND guest_subject_id IS NULL)
  OR (kind = 'guest' AND user_id IS NULL AND ((guest_token_hash IS NOT NULL AND guest_subject_id IS NULL) OR (guest_token_hash IS NULL AND guest_subject_id IS NOT NULL)))
);
CREATE UNIQUE INDEX gpc_scisure_principals_guest_subject_key ON gpc_scisure_principals(guest_subject_id) WHERE guest_subject_id IS NOT NULL;

CREATE OR REPLACE FUNCTION gpc_reserve_scisure_guest_job(
  p_subject_id UUID, p_principal_id UUID, p_snapshot_id UUID, p_idempotency_key TEXT, p_limit INTEGER
) RETURNS TABLE(job_id UUID, replayed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job UUID; v_used INTEGER; v_scope TEXT := 'guest-subject:' || p_subject_id::TEXT;
BEGIN
  IF p_limit < 1 OR p_limit > 1000 OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' THEN RAISE EXCEPTION 'invalid guest job reservation'; END IF;
  PERFORM 1 FROM gpc_scisure_guest_subjects WHERE id=p_subject_id AND expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'guest subject unavailable'; END IF;
  PERFORM 1 FROM gpc_scisure_principals WHERE id=p_principal_id AND kind='guest' AND guest_subject_id=p_subject_id AND revoked_at IS NULL AND expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'guest principal is not owned by subject'; END IF;
  PERFORM 1 FROM gpc_external_source_snapshots s JOIN gpc_scisure_connections c ON c.id=s.connection_id
    WHERE s.id=p_snapshot_id AND s.principal_id=p_principal_id AND c.principal_id=p_principal_id AND s.expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot is not owned by guest principal'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_subject_id::TEXT,0));
  SELECT id INTO v_job FROM gpc_scisure_jobs WHERE principal_id=p_principal_id AND idempotency_key=p_idempotency_key;
  IF v_job IS NOT NULL THEN RETURN QUERY SELECT v_job,true; RETURN; END IF;
  SELECT count(*) INTO v_used FROM gpc_scisure_guest_subject_reservations WHERE subject_id=p_subject_id;
  IF v_used >= p_limit THEN RAISE EXCEPTION 'guest analysis quota exhausted'; END IF;
  INSERT INTO gpc_scisure_jobs(principal_id,snapshot_id,idempotency_key,status,expires_at)
    VALUES(p_principal_id,p_snapshot_id,p_idempotency_key,'queued',now()+interval '90 days') RETURNING id INTO v_job;
  INSERT INTO gpc_scisure_guest_subject_reservations(subject_id,idempotency_key) VALUES(p_subject_id,p_idempotency_key);
  INSERT INTO gpc_scisure_quota_reservations(scope_key,job_id,state) VALUES(v_scope,v_job,'reserved');
  RETURN QUERY SELECT v_job,false;
END $$;

CREATE OR REPLACE FUNCTION gpc_consume_scisure_guest_email_challenge(p_token_hash TEXT, p_now TIMESTAMPTZ)
RETURNS TABLE(subject_id UUID, expires_at TIMESTAMPTZ) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN QUERY UPDATE gpc_scisure_guest_email_challenges
    SET consumed_at=p_now WHERE token_hash=p_token_hash AND consumed_at IS NULL AND expires_at>p_now
    RETURNING gpc_scisure_guest_email_challenges.subject_id, gpc_scisure_guest_email_challenges.expires_at;
END $$;

CREATE OR REPLACE FUNCTION gpc_reserve_scisure_guest_subject_trial(p_subject_id UUID, p_idempotency_key TEXT, p_limit INTEGER)
RETURNS TABLE(state TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE used_count INTEGER;
BEGIN
  IF p_limit < 1 OR p_limit > 1000 OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' THEN RAISE EXCEPTION 'invalid guest trial reservation'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_subject_id::TEXT, 0));
  IF EXISTS(SELECT 1 FROM gpc_scisure_guest_subject_reservations WHERE subject_id=p_subject_id AND idempotency_key=p_idempotency_key) THEN RETURN QUERY SELECT 'replayed'; RETURN; END IF;
  SELECT count(*) INTO used_count FROM gpc_scisure_guest_subject_reservations WHERE subject_id=p_subject_id;
  IF used_count >= p_limit THEN RETURN QUERY SELECT 'exhausted'; RETURN; END IF;
  INSERT INTO gpc_scisure_guest_subject_reservations(subject_id,idempotency_key) VALUES(p_subject_id,p_idempotency_key);
  RETURN QUERY SELECT 'reserved';
END $$;

CREATE OR REPLACE FUNCTION gpc_scisure_guest_subject_remaining(p_subject_id UUID, p_limit INTEGER)
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT GREATEST(0, p_limit - count(*)::INTEGER) FROM gpc_scisure_guest_subject_reservations WHERE subject_id=p_subject_id
$$;

CREATE OR REPLACE FUNCTION gpc_claim_scisure_guest_result(p_subject_id UUID, p_user_id UUID, p_job_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RAISE EXCEPTION 'account unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM gpc_scisure_jobs j JOIN gpc_scisure_principals p ON p.id=j.principal_id WHERE j.id=p_job_id AND p.kind='guest' AND p.guest_subject_id=p_subject_id) THEN RAISE EXCEPTION 'guest result is not owned by subject'; END IF;
  INSERT INTO gpc_scisure_guest_claims(subject_id,job_id,user_id) VALUES(p_subject_id,p_job_id,p_user_id) ON CONFLICT(job_id) DO NOTHING;
END $$;

ALTER TABLE gpc_scisure_guest_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_guest_email_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_guest_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_guest_email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_guest_subject_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_scisure_guest_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION gpc_reserve_scisure_guest_job(UUID,UUID,UUID,TEXT,INTEGER),gpc_consume_scisure_guest_email_challenge(TEXT,TIMESTAMPTZ),gpc_reserve_scisure_guest_subject_trial(UUID,TEXT,INTEGER),gpc_scisure_guest_subject_remaining(UUID,INTEGER),gpc_claim_scisure_guest_result(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_reserve_scisure_guest_job(UUID,UUID,UUID,TEXT,INTEGER),gpc_consume_scisure_guest_email_challenge(TEXT,TIMESTAMPTZ),gpc_reserve_scisure_guest_subject_trial(UUID,TEXT,INTEGER),gpc_scisure_guest_subject_remaining(UUID,INTEGER),gpc_claim_scisure_guest_result(UUID,UUID,UUID) TO service_role;
