-- Fix "column reference 'job_id' is ambiguous" in gpc_lease_scisure_job.
-- The function RETURNS TABLE(job_id UUID, ...), which makes 'job_id' an
-- implicit output variable in the function body. That collides with the
-- 'job_id' column on gpc_scisure_quota_reservations. Drop and recreate the
-- function with the output column renamed to 'out_job_id'. The worker
-- (scripts/run-scisure-worker.ts) is updated to read row.out_job_id.

DROP FUNCTION IF EXISTS gpc_lease_scisure_job(INTEGER);
CREATE FUNCTION gpc_lease_scisure_job(p_lease_seconds INTEGER DEFAULT 900)
RETURNS TABLE(out_job_id UUID, principal_id UUID, principal_kind TEXT, owner_user_id UUID, snapshot_id UUID, source_hash TEXT, protocol_text TEXT, lease_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job UUID; v_token UUID;
BEGIN
  IF p_lease_seconds < 900 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  WITH stale AS (
    UPDATE gpc_scisure_jobs SET status='uncertain', error_code='lease_expired_unknown_outcome', completed_at=now(), lease_expires_at=NULL, lease_token=NULL
      WHERE status='running' AND lease_expires_at < now() AND expires_at > now() RETURNING id
  ) UPDATE gpc_scisure_quota_reservations SET state='uncertain', updated_at=now()
    WHERE job_id IN (SELECT id FROM stale);
  SELECT id INTO v_job FROM gpc_scisure_jobs WHERE status='queued' AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_job IS NULL THEN RETURN; END IF;
  v_token := gen_random_uuid();
  UPDATE gpc_scisure_jobs SET status='running',leased_at=now(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),lease_token=v_token WHERE id=v_job;
  UPDATE gpc_scisure_quota_reservations SET state='running',updated_at=now() WHERE job_id=v_job;
  RETURN QUERY SELECT j.id,j.principal_id,p.kind,c.owner_user_id,j.snapshot_id,s.source_hash,s.protocol_text,j.lease_token
    FROM gpc_scisure_jobs j JOIN gpc_scisure_principals p ON p.id=j.principal_id JOIN gpc_external_source_snapshots s ON s.id=j.snapshot_id
    JOIN gpc_scisure_connections c ON c.id=s.connection_id WHERE j.id=v_job;
END $$;

REVOKE ALL ON FUNCTION gpc_lease_scisure_job(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_lease_scisure_job(INTEGER) TO service_role;
