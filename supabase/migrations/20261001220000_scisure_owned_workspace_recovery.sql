-- Owner-authenticated account readback, not email-based guest recovery.
-- Short-lived connection expiry never deletes a signed-in scientist's retained work.
CREATE FUNCTION public.gpc_get_owned_scisure_workspace(p_analysis_id UUID,p_owner_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.gpc_scisure_jobs%ROWTYPE; s public.gpc_external_source_snapshots%ROWTYPE;
  result JSONB; revision INTEGER; decisions JSONB; finding JSONB; original JSONB;
  finding_index INTEGER; finding_id TEXT; seen TEXT[] := '{}';
BEGIN
  IF p_analysis_id IS NULL OR p_owner_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT job.* INTO j FROM public.gpc_scisure_jobs job
    JOIN public.gpc_scisure_principals p ON p.id=job.principal_id
    JOIN public.gpc_analyses a ON a.id=job.analysis_id
    JOIN public.gpc_external_source_snapshots snapshot ON snapshot.id=job.snapshot_id
    WHERE job.analysis_id=p_analysis_id AND job.status='completed' AND job.expires_at>now()
      AND p.kind='registered' AND p.user_id=p_owner_user_id AND p.revoked_at IS NULL
      AND a.user_id=p_owner_user_id AND snapshot.principal_id=p.id AND snapshot.expires_at>now()
    ORDER BY job.created_at DESC,job.id DESC LIMIT 1 FOR SHARE OF job,p,a,snapshot;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT snapshot.* INTO s FROM public.gpc_external_source_snapshots snapshot
    JOIN public.gpc_scisure_connections c ON c.id=snapshot.connection_id
    WHERE snapshot.id=j.snapshot_id AND snapshot.principal_id=j.principal_id
      AND snapshot.expires_at>now() AND c.principal_id=j.principal_id AND c.owner_user_id=p_owner_user_id
    FOR SHARE OF snapshot,c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT a.analysis_result,a.revision_number INTO result,revision FROM public.gpc_analyses a
    JOIN public.gpc_analysis_runs r ON r.id=j.analysis_run_id
    WHERE a.id=p_analysis_id AND a.user_id=p_owner_user_id AND a.protocol_text=s.protocol_text
      AND a.source_snapshot_hash=s.source_hash AND r.user_id=p_owner_user_id
      AND r.analysis_id=a.id AND r.run_source='scisure' AND r.status='completed' FOR SHARE OF a,r;
  IF NOT FOUND OR revision IS NULL OR revision<0 OR jsonb_typeof(result->'recommendations') IS DISTINCT FROM 'array'
    OR jsonb_typeof(j.result->'recommendations') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  FOR finding,finding_index IN SELECT value,(ordinality-1)::integer FROM jsonb_array_elements(result->'recommendations') WITH ORDINALITY LOOP
    IF jsonb_typeof(finding) IS DISTINCT FROM 'object' OR (finding->'id' IS NOT NULL AND finding->'id'<>'null'::jsonb AND jsonb_typeof(finding->'id')<>'string') THEN RETURN NULL; END IF;
    finding_id := COALESCE(NULLIF(finding->>'id',''),'finding-' || finding_index::text);
    IF finding_id !~ '^[A-Za-z0-9._:-]{1,160}$' OR finding_id=ANY(seen) THEN RETURN NULL; END IF;
    seen := array_append(seen,finding_id);
    IF NULLIF(finding->>'id','') IS NULL THEN
      original := j.result->'recommendations'->finding_index;
      IF original IS NULL OR NULLIF(original->>'id','') IS NOT NULL OR (original-'isAccepted') IS DISTINCT FROM (finding-'isAccepted') THEN RETURN NULL; END IF;
    END IF;
  END LOOP;
  SELECT COALESCE(jsonb_object_agg(d.finding_id,d.decision),'{}'::jsonb) INTO decisions
    FROM public.gpc_scisure_workspace_decisions d WHERE d.job_id=j.id AND d.snapshot_id=s.id
      AND d.principal_id=j.principal_id AND d.source_hash=s.source_hash AND d.analysis_revision=revision
      AND d.reviewer_user_id=p_owner_user_id AND d.guest_subject_id IS NULL;
  RETURN jsonb_build_object('version',2,'bridgeSessionId',s.connection_id,'snapshotId',s.id,'sourceHash',s.source_hash,
    'runId',j.id,'status','completed','principalKind','registered','analysisId',p_analysis_id,
    'analysisRevision',revision,'source',s.source,'analysis',result,'findings','[]'::jsonb,
    'decisions',decisions,'retentionExpiresAt',LEAST(j.expires_at,s.expires_at));
END $$;
REVOKE ALL ON FUNCTION public.gpc_get_owned_scisure_workspace(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gpc_get_owned_scisure_workspace(UUID,UUID) TO service_role;
