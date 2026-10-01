-- Revert the out_job_id rename: keep the output column as job_id (so the
-- worker's row.job_id read still works) and use subqueries to hide the
-- 'job_id' table column from the PL/pgSQL parser. When the function
-- RETURNS TABLE(job_id UUID, ...), the parser treats 'job_id' as an
-- implicit output variable. Wrapping the table reference in a subquery
-- (SELECT * FROM gpc_scisure_quota_reservations) lets the bare 'job_id'
-- resolve to the table column unambiguously.

DROP FUNCTION IF EXISTS gpc_lease_scisure_job(INTEGER);
CREATE FUNCTION gpc_lease_scisure_job(p_lease_seconds INTEGER DEFAULT 900)
RETURNS TABLE(job_id UUID, principal_id UUID, principal_kind TEXT, owner_user_id UUID, snapshot_id UUID, source_hash TEXT, protocol_text TEXT, lease_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job UUID; v_token UUID;
BEGIN
  IF p_lease_seconds < 900 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  WITH stale AS (
    UPDATE gpc_scisure_jobs SET status='uncertain', error_code='lease_expired_unknown_outcome', completed_at=now(), lease_expires_at=NULL, lease_token=NULL
      WHERE status='running' AND lease_expires_at < now() AND expires_at > now() RETURNING id
  ) UPDATE gpc_scisure_quota_reservations r SET state='uncertain', updated_at=now()
    FROM stale s WHERE r.job_id=s.id;
  SELECT id INTO v_job FROM gpc_scisure_jobs WHERE status='queued' AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_job IS NULL THEN RETURN; END IF;
  v_token := gen_random_uuid();
  UPDATE gpc_scisure_jobs j SET status='running',leased_at=now(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),lease_token=v_token FROM (SELECT v_job AS id) src WHERE j.id=src.id;
  UPDATE gpc_scisure_quota_reservations r SET state='running',updated_at=now() FROM (SELECT v_job AS job_id) src WHERE r.job_id=src.job_id;
  RETURN QUERY SELECT j.id,j.principal_id,p.kind,c.owner_user_id,j.snapshot_id,s.source_hash,s.protocol_text,j.lease_token
    FROM gpc_scisure_jobs j JOIN gpc_scisure_principals p ON p.id=j.principal_id JOIN gpc_external_source_snapshots s ON s.id=j.snapshot_id
    JOIN gpc_scisure_connections c ON c.id=s.connection_id WHERE j.id=v_job;
END $$;

REVOKE ALL ON FUNCTION gpc_lease_scisure_job(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_lease_scisure_job(INTEGER) TO service_role;
