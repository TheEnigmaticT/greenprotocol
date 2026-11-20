\set ON_ERROR_STOP on
\ir scisure-workspace.sql
\ir ../../supabase/migrations/20261001220000_scisure_owned_workspace_recovery.sql
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-000000000221'; p uuid; c uuid; s uuid; a uuid; r uuid; j uuid; data jsonb;
  result jsonb := '{"protocolTitle":"Explicit SQL recovery fixture","steps":[],"recommendations":[{"id":"recovery-warning","cardKind":"warning","stepNumber":1}]}'::jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(u,'recovery-fixture@example.test');
  INSERT INTO gpc_scisure_principals(kind,user_id) VALUES('registered',u) RETURNING id INTO p;
  INSERT INTO gpc_scisure_connections(principal_id,owner_user_id,allowed_origin,nonce_hash,credential_id,credential_hash,expires_at)
    VALUES(p,u,'https://sandbox.elabjournal.com','nonce','recovery-fixture','secret',now()+interval '67 minutes') RETURNING id INTO c;
  INSERT INTO gpc_external_source_snapshots(principal_id,connection_id,source_hash,source,protocol_text,expires_at)
    VALUES(p,c,repeat('e',64),'{"version":1,"kind":"experiment","externalId":"221","title":"Explicit SQL fixture","selection":[],"protocolText":"Add water.","importWarnings":[]}', 'Add water.',now()+interval '90 days') RETURNING id INTO s;
  INSERT INTO gpc_analyses(user_id,protocol_text,analysis_result,source_snapshot_hash,revision_number)
    VALUES(u,'Add water.',result,repeat('e',64),1) RETURNING id INTO a;
  INSERT INTO gpc_analysis_runs(user_id,analysis_id,status,run_source) VALUES(u,a,'completed','scisure') RETURNING id INTO r;
  INSERT INTO gpc_scisure_jobs(principal_id,snapshot_id,idempotency_key,status,analysis_id,analysis_run_id,result,completed_at,expires_at)
    VALUES(p,s,'owned-recovery-fixture','completed',a,r,result,now(),now()+interval '90 days') RETURNING id INTO j;
  PERFORM assert_true(gpc_record_scisure_workspace_decision(c,s,p,u,NULL,'recovery-warning','accepted',repeat('e',64),1),'fixture decision must persist');
  UPDATE gpc_scisure_connections SET expires_at=now()-interval '1 minute' WHERE id=c;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL) IS NULL,'expired browser credential must not recover the bridge');
  data := gpc_get_owned_scisure_workspace(a,u);
  PERFORM assert_true(data IS NOT NULL,'signed owner must recover retained data without a live popup');
  PERFORM assert_true(data#>>'{decisions,recovery-warning}'='accepted','durable review must survive popup expiry');
  PERFORM assert_true(data->>'analysisId'=a::text,'exact owned analysis must be returned');
  PERFORM assert_true(gpc_get_owned_scisure_workspace(a,'00000000-0000-0000-0000-000000000222') IS NULL,'another signed account cannot recover source');
  PERFORM assert_true(gpc_get_owned_scisure_workspace(a,NULL) IS NULL,'unsigned identity cannot recover by email');
  UPDATE gpc_external_source_snapshots SET expires_at=now()-interval '1 minute' WHERE id=s;
  PERFORM assert_true(gpc_get_owned_scisure_workspace(a,u) IS NULL,'expired retention remains inaccessible');
  PERFORM assert_true(NOT has_function_privilege('anon','gpc_get_owned_scisure_workspace(uuid,uuid)','EXECUTE'),'anonymous cannot impersonate owner');
  PERFORM assert_true(NOT has_function_privilege('authenticated','gpc_get_owned_scisure_workspace(uuid,uuid)','EXECUTE'),'direct client cannot supply another owner ID');
  PERFORM assert_true(has_function_privilege('service_role','gpc_get_owned_scisure_workspace(uuid,uuid)','EXECUTE'),'server owner verifier can recover');
END $$;
SELECT 'Owned recovery preserves privacy, decisions and retention after connection expiry' AS result;
