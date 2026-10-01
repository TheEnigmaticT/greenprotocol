-- Fix "column reference 'job_id' is ambiguous" in gpc_lease_scisure_job.
-- The function RETURNS TABLE(job_id UUID, ...), which makes 'job_id' an
-- implicit output variable in the function body. That collides with the
-- 'job_id' column on gpc_scisure_quota_reservations and gpc_scisure_jobs.
-- Use explicit table aliases (r, j) so the column reference is unambiguous.

CREATE OR REPLACE FUNCTION gpc_lease_scisure_job(p_lease_seconds INTEGER DEFAULT 900)
RETURNS TABLE(job_id UUID, principal_id UUID, principal_kind TEXT, owner_user_id UUID, snapshot_id UUID, source_hash TEXT, protocol_text TEXT, lease_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job UUID; v_token UUID;
BEGIN
  IF p_lease_seconds < 900 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  WITH stale AS (
    UPDATE gpc_scisure_jobs AS j SET status='uncertain', error_code='lease_expired_unknown_outcome', completed_at=now(), lease_expires_at=NULL, lease_token=NULL
      WHERE j.status='running' AND j.lease_expires_at < now() AND j.expires_at > now() RETURNING j.id
  ), uncertained AS (
    UPDATE gpc_scisure_quota_reservations AS r SET state='uncertain', updated_at=now()
      WHERE r.job_id IN (SELECT id FROM stale) RETURNING r.job_id
  )
  SELECT 1;
  SELECT j.id INTO v_job FROM gpc_scisure_jobs AS j WHERE j.status='queued' AND j.expires_at>now() ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_job IS NULL THEN RETURN; END IF;
  v_token := gen_random_uuid();
  UPDATE gpc_scisure_jobs AS j SET status='running',leased_at=now(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),lease_token=v_token WHERE j.id=v_job;
  UPDATE gpc_scisure_quota_reservations AS r SET state='running',updated_at=now() WHERE r.job_id=v_job;
  RETURN QUERY SELECT j.id,j.principal_id,p.kind,c.owner_user_id,j.snapshot_id,s.source_hash,s.protocol_text,j.lease_token
    FROM gpc_scisure_jobs AS j JOIN gpc_scisure_principals AS p ON p.id=j.principal_id JOIN gpc_external_source_snapshots AS s ON s.id=j.snapshot_id
    JOIN gpc_scisure_connections AS c ON c.id=s.connection_id WHERE j.id=v_job;
END $$;

REVOKE ALL ON FUNCTION gpc_lease_scisure_job(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_lease_scisure_job(INTEGER) TO service_role;
