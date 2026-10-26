-- Private review v2, staging-authorized. V1 eligibility/quota RPCs are unchanged.
-- Decisions are raw lineage: existing 90-day job purge cascades these records.
CREATE TABLE public.gpc_scisure_workspace_decisions (
  job_id UUID NOT NULL REFERENCES public.gpc_scisure_jobs(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES public.gpc_external_source_snapshots(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES public.gpc_scisure_principals(id) ON DELETE RESTRICT,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  analysis_revision INTEGER NOT NULL CHECK (analysis_revision >= 0),
  finding_id TEXT NOT NULL CHECK (finding_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
  reviewer_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  guest_subject_id UUID REFERENCES public.gpc_scisure_guest_subjects(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((reviewer_user_id IS NOT NULL)::integer + (guest_subject_id IS NOT NULL)::integer = 1),
  PRIMARY KEY (job_id, analysis_revision, finding_id)
);
ALTER TABLE public.gpc_scisure_workspace_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gpc_scisure_workspace_decisions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.gpc_scisure_workspace_decisions TO service_role;
-- No client policies and no public share/recovery token storage.

CREATE FUNCTION public.gpc_get_scisure_workspace(
  p_connection_id UUID, p_snapshot_id UUID, p_principal_id UUID,
  p_reviewer_user_id UUID, p_guest_subject_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.gpc_scisure_jobs%ROWTYPE; v_snapshot public.gpc_external_source_snapshots%ROWTYPE;
  v_principal public.gpc_scisure_principals%ROWTYPE; v_analysis JSONB; v_revision INTEGER := 0;
  v_decisions JSONB; v_ids TEXT[] := '{}'; v_id TEXT; v_rec JSONB; v_index INTEGER; v_original JSONB;
BEGIN
  IF p_connection_id IS NULL OR p_snapshot_id IS NULL OR p_principal_id IS NULL
    OR (p_reviewer_user_id IS NOT NULL)::integer + (p_guest_subject_id IS NOT NULL)::integer <> 1 THEN RETURN NULL; END IF;
  -- Read locks make source/job/canonical revision and decisions one coherent view.
  -- Decision writers lock the same job exclusively before taking this view.
  SELECT s.* INTO v_snapshot FROM public.gpc_external_source_snapshots s
    JOIN public.gpc_scisure_connections c ON c.id=s.connection_id
    JOIN public.gpc_scisure_principals p ON p.id=s.principal_id
    WHERE s.id=p_snapshot_id AND s.connection_id=p_connection_id AND s.principal_id=p_principal_id
      AND c.principal_id=p_principal_id AND c.revoked_at IS NULL AND c.expires_at>now()
      AND p.revoked_at IS NULL AND (p.expires_at IS NULL OR p.expires_at>now()) AND s.expires_at>now()
      AND ((p.kind='registered' AND p.user_id=p_reviewer_user_id AND c.owner_user_id=p.user_id AND p_guest_subject_id IS NULL)
        OR (p.kind='guest' AND p.guest_subject_id=p_guest_subject_id AND p_reviewer_user_id IS NULL AND c.owner_user_id IS NULL AND p.expires_at>now()))
    FOR SHARE OF s,c,p;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_principal FROM public.gpc_scisure_principals WHERE id=p_principal_id;
  IF v_principal.kind='guest' AND NOT EXISTS (
    SELECT 1 FROM public.gpc_scisure_guest_subjects gs JOIN public.gpc_scisure_guest_admissions ga ON ga.subject_id=gs.id
    WHERE gs.id=p_guest_subject_id AND gs.expires_at>now() AND ga.revoked_at IS NULL AND ga.expires_at>now()
  ) THEN RETURN NULL; END IF;
  SELECT * INTO v_job FROM public.gpc_scisure_jobs
    WHERE snapshot_id=p_snapshot_id AND principal_id=p_principal_id AND expires_at>now()
    ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_job.status='completed' THEN
    IF v_principal.kind='registered' THEN
      SELECT a.analysis_result,a.revision_number INTO v_analysis,v_revision
        FROM public.gpc_analyses a JOIN public.gpc_analysis_runs r ON r.id=v_job.analysis_run_id
        WHERE a.id=v_job.analysis_id AND a.user_id=p_reviewer_user_id
          AND a.source_snapshot_hash=v_snapshot.source_hash AND a.protocol_text=v_snapshot.protocol_text
          AND r.user_id=p_reviewer_user_id AND r.analysis_id=a.id AND r.run_source='scisure' AND r.status='completed'
        FOR SHARE OF a,r;
      IF NOT FOUND OR v_revision IS NULL OR v_revision<0 THEN RETURN NULL; END IF;
    ELSE
      -- Guests intentionally have no canonical registered analysis/chat/run rows.
      IF v_job.analysis_id IS NOT NULL OR v_job.analysis_run_id IS NOT NULL THEN RETURN NULL; END IF;
      v_analysis := v_job.result;
    END IF;
    IF jsonb_typeof(v_analysis->'recommendations') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_job.result->'recommendations') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
    FOR v_rec,v_index IN SELECT value,(ordinality-1)::integer FROM jsonb_array_elements(v_analysis->'recommendations') WITH ORDINALITY LOOP
      IF jsonb_typeof(v_rec) IS DISTINCT FROM 'object' OR (v_rec->'id' IS NOT NULL AND v_rec->'id'<>'null'::jsonb AND jsonb_typeof(v_rec->'id')<>'string') THEN RETURN NULL; END IF;
      v_id := COALESCE(NULLIF(v_rec->>'id',''),'finding-' || v_index::text);
      IF v_id !~ '^[A-Za-z0-9._:-]{1,160}$' OR v_id=ANY(v_ids) THEN RETURN NULL; END IF;
      v_ids := array_append(v_ids,v_id);
      IF NULLIF(v_rec->>'id','') IS NULL THEN
        -- Missing-ID warnings stay at their immutable snapshot index. A canonical
        -- reorder/replacement cannot silently reassign an existing review ID.
        v_original := v_job.result->'recommendations'->v_index;
        IF v_original IS NULL OR NULLIF(v_original->>'id','') IS NOT NULL
          OR (v_original-'isAccepted') IS DISTINCT FROM (v_rec-'isAccepted') THEN RETURN NULL; END IF;
      END IF;
    END LOOP;
  END IF;
  SELECT COALESCE(jsonb_object_agg(d.finding_id,d.decision),'{}'::jsonb) INTO v_decisions
    FROM public.gpc_scisure_workspace_decisions d
    WHERE d.job_id=v_job.id AND d.snapshot_id=p_snapshot_id AND d.principal_id=p_principal_id
      AND d.source_hash=v_snapshot.source_hash AND d.analysis_revision=v_revision
      AND d.reviewer_user_id IS NOT DISTINCT FROM p_reviewer_user_id AND d.guest_subject_id IS NOT DISTINCT FROM p_guest_subject_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'version',2,'bridgeSessionId',p_connection_id,'snapshotId',p_snapshot_id,'sourceHash',v_snapshot.source_hash,
    'runId',v_job.id,'status',v_job.status,'principalKind',v_principal.kind,'analysisId',v_job.analysis_id,
    'analysisRevision',v_revision,'source',v_snapshot.source,'analysis',v_analysis,'findings','[]'::jsonb,
    'decisions',v_decisions,'retentionExpiresAt',LEAST(v_job.expires_at,v_snapshot.expires_at)
  )) || jsonb_build_object('analysis',v_analysis);
END $$;

CREATE FUNCTION public.gpc_record_scisure_workspace_decision(
  p_connection_id UUID, p_snapshot_id UUID, p_principal_id UUID,
  p_reviewer_user_id UUID, p_guest_subject_id UUID,
  p_finding_id TEXT, p_decision TEXT, p_source_hash TEXT, p_analysis_revision INTEGER
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.gpc_scisure_jobs%ROWTYPE; v_workspace JSONB; v_matches INTEGER;
BEGIN
  IF p_finding_id IS NULL OR p_decision IS NULL OR p_source_hash IS NULL OR p_analysis_revision IS NULL
    OR p_finding_id !~ '^[A-Za-z0-9._:-]{1,160}$' OR p_decision NOT IN ('accepted','rejected')
    OR p_source_hash !~ '^[a-f0-9]{64}$' OR p_analysis_revision<0 THEN RETURN false; END IF;
  SELECT * INTO v_job FROM public.gpc_scisure_jobs
    WHERE snapshot_id=p_snapshot_id AND principal_id=p_principal_id AND status='completed' AND expires_at>now()
    ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_job.analysis_id IS NOT NULL THEN
    PERFORM 1 FROM public.gpc_analyses WHERE id=v_job.analysis_id FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  v_workspace := public.gpc_get_scisure_workspace(p_connection_id,p_snapshot_id,p_principal_id,p_reviewer_user_id,p_guest_subject_id);
  IF v_workspace IS NULL OR v_workspace->>'status'<>'completed' OR v_workspace->>'runId'<>v_job.id::text
    OR v_workspace->>'sourceHash'<>p_source_hash OR (v_workspace->>'analysisRevision')::integer<>p_analysis_revision THEN RETURN false; END IF;
  -- All normal findings, not the v1 swap-eligibility subset. Scientific gates
  -- remain in the draft builder; accepting a warning only acknowledges it.
  SELECT count(*) INTO v_matches FROM jsonb_array_elements(v_workspace#>'{analysis,recommendations}') WITH ORDINALITY rec(value,ordinality)
    WHERE COALESCE(NULLIF(value->>'id',''),'finding-' || (ordinality-1)::text)=p_finding_id;
  IF v_matches<>1 THEN RETURN false; END IF;
  INSERT INTO public.gpc_scisure_workspace_decisions(job_id,snapshot_id,principal_id,source_hash,analysis_revision,finding_id,decision,reviewer_user_id,guest_subject_id)
    VALUES(v_job.id,p_snapshot_id,p_principal_id,p_source_hash,p_analysis_revision,p_finding_id,p_decision,p_reviewer_user_id,p_guest_subject_id)
    ON CONFLICT(job_id,analysis_revision,finding_id) DO UPDATE SET decision=EXCLUDED.decision,updated_at=now();
  RETURN true;
END $$;

-- Revoke after final CREATE, including Supabase default grants. No unrelated RPC widening.
REVOKE ALL ON FUNCTION public.gpc_get_scisure_workspace(UUID,UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gpc_record_scisure_workspace_decision(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gpc_get_scisure_workspace(UUID,UUID,UUID,UUID,UUID),public.gpc_record_scisure_workspace_decision(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,INTEGER) TO service_role;
