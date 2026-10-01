-- Fix PostgreSQL "column reference 'job_id' is ambiguous" error in
-- gpc_complete_scisure_job and gpc_fail_scisure_job. Both functions
-- parameterize p_job_id but the bare 'job_id' in the WHERE clauses
-- conflicts with the same-named column on the updated tables when the
-- PL/pgSQL parser is asked to resolve the reference. Schema-qualify
-- the column references so the compiler can resolve them unambiguously.

CREATE OR REPLACE FUNCTION gpc_complete_scisure_job(p_job_id UUID,p_lease_token UUID,p_analysis_id UUID,p_analysis_run_id UUID,p_result JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE gpc_scisure_jobs SET status='completed',analysis_id=p_analysis_id,analysis_run_id=p_analysis_run_id,result=p_result,completed_at=now(),lease_expires_at=NULL,lease_token=NULL
    WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>now();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE gpc_scisure_quota_reservations SET state='completed',updated_at=now() WHERE gpc_scisure_quota_reservations.job_id=p_job_id;
  UPDATE gpc_registered_analysis_quota_ledger SET state='completed',updated_at=now() WHERE gpc_registered_analysis_quota_ledger.job_id=p_job_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION gpc_fail_scisure_job(p_job_id UUID,p_lease_token UUID,p_status TEXT,p_error_code TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_status NOT IN ('failed','uncertain') THEN RAISE EXCEPTION 'invalid final status'; END IF;
  UPDATE gpc_scisure_jobs SET status=p_status,error_code=left(p_error_code,160),completed_at=now(),lease_expires_at=NULL,lease_token=NULL
    WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_expires_at>now();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE gpc_scisure_quota_reservations SET state=CASE WHEN p_status='uncertain' THEN 'uncertain' ELSE 'released' END,updated_at=now() WHERE gpc_scisure_quota_reservations.job_id=p_job_id;
  UPDATE gpc_registered_analysis_quota_ledger SET state=CASE WHEN p_status='uncertain' THEN 'uncertain' ELSE 'failed' END,updated_at=now() WHERE gpc_registered_analysis_quota_ledger.job_id=p_job_id;
  RETURN true;
END $$;

-- Re-assert service-only access for the re-defined functions.
REVOKE ALL ON FUNCTION gpc_complete_scisure_job(UUID,UUID,UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_fail_scisure_job(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_complete_scisure_job(UUID,UUID,UUID,UUID,JSONB),gpc_fail_scisure_job(UUID,UUID,TEXT,TEXT) TO service_role;
