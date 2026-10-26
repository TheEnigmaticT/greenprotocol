\set ON_ERROR_STOP on
-- Entirely synthetic, disposable PostgreSQL fixture. No application credentials.
\ir scisure-registered-security.sql
CREATE OR REPLACE FUNCTION assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;
-- Reproduce Supabase default grants before the final CREATE, not only afterwards.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
\ir ../../supabase/migrations/20261001210000_scisure_private_workspace.sql
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-000000000071'; other_u uuid := '00000000-0000-0000-0000-000000000072'; p uuid; c uuid; s uuid; j uuid; a uuid; r uuid; f text; w jsonb;
  fixture jsonb := '{"protocolTitle":"Synthetic four findings","steps":[],"recommendations":[{"cardKind":"warning","original":{"chemical":"Acetone"}},{"cardKind":"warning"},{"cardKind":"warning"},{"id":"hypothesis","cardKind":"swap","evidenceAssessment":{"eligibleForApplication":false,"disposition":"analogous_only"}}]}';
BEGIN
  INSERT INTO auth.users VALUES (u,'owner@example.test'),(other_u,'spoofed@example.test');
  INSERT INTO gpc_scisure_principals(kind,user_id) VALUES ('registered',u) RETURNING id INTO p;
  INSERT INTO gpc_scisure_connections(principal_id,owner_user_id,allowed_origin,nonce_hash,credential_id,credential_hash,expires_at)
    VALUES (p,u,'https://sandbox.elabjournal.com','workspace-nonce','workspace-credential','fixture',now()+interval '67 minutes') RETURNING id INTO c;
  INSERT INTO gpc_external_source_snapshots(principal_id,connection_id,source_hash,source,protocol_text,expires_at)
    VALUES (p,c,repeat('a',64),'{"selection":[{"stepId":"original-7","order":7}]}','Original text.',now()+interval '90 days') RETURNING id INTO s;
  INSERT INTO gpc_analyses(user_id,protocol_text,analysis_result,source_snapshot_hash) VALUES (u,'Original text.',fixture,repeat('a',64)) RETURNING id INTO a;
  INSERT INTO gpc_analysis_runs(user_id,analysis_id,status,run_source) VALUES(u,a,'completed','scisure') RETURNING id INTO r;
  INSERT INTO gpc_scisure_jobs(principal_id,snapshot_id,idempotency_key,status,analysis_id,analysis_run_id,result,expires_at)
    VALUES (p,s,'workspace-synthetic','completed',a,r,fixture,now()+interval '90 days') RETURNING id INTO j;
  w := gpc_get_scisure_workspace(c,s,p,u,NULL);
  PERFORM assert_true(jsonb_array_length(w#>'{analysis,recommendations}')=4, 'GET must retain every warning and hypothesis');
  UPDATE gpc_analyses SET analysis_result=fixture || '{"nullableScientificField":null}'::jsonb WHERE id=a;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL)#>'{analysis,nullableScientificField}'='null'::jsonb,'full analysis preserves explicit scientific nulls');
  UPDATE gpc_analyses SET analysis_result=fixture WHERE id=a;
  PERFORM assert_true(w->>'analysisId'=a::text AND (w->>'analysisRevision')::integer=1,'canonical signed-in analysis and revision reused for Ask');
  FOREACH f IN ARRAY ARRAY['finding-0','finding-1','finding-2','hypothesis'] LOOP
    PERFORM assert_true(gpc_record_scisure_workspace_decision(c,s,p,u,NULL,f,'accepted',repeat('a',64),1),'all findings support durable review, not only swaps');
  END LOOP;
  PERFORM assert_true((SELECT count(*) FROM gpc_scisure_workspace_decisions WHERE job_id=j)=4,'four principal-bound decisions');
  PERFORM assert_true(gpc_record_scisure_workspace_decision(c,s,p,u,NULL,'finding-0','rejected',repeat('a',64),1),'decision replacement is durable');
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL)#>>'{decisions,finding-0}'='rejected','readback durable decision');
  PERFORM assert_true(NOT gpc_record_scisure_workspace_decision(c,s,p,other_u,NULL,'finding-0','accepted',repeat('a',64),1),'spoofed reviewer cannot write');
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,other_u,NULL) IS NULL,'spoofed reviewer cannot read');
  PERFORM assert_true(NOT gpc_record_scisure_workspace_decision(c,s,p,u,NULL,'invented','accepted',repeat('a',64),1),'invented ID rejected');
  PERFORM assert_true(NOT gpc_record_scisure_workspace_decision(c,s,p,u,NULL,'finding-00','accepted',repeat('a',64),1),'index alias rejected');
  PERFORM assert_true(NOT gpc_record_scisure_workspace_decision(c,s,p,u,NULL,'finding-0','accepted',repeat('b',64),1),'source hash CAS');
  PERFORM assert_true(NOT gpc_record_scisure_workspace_decision(c,s,p,u,NULL,'finding-0',NULL,repeat('a',64),1),'SQL NULL fail closed');
  UPDATE gpc_analyses SET revision_number=2 WHERE id=a;
  PERFORM assert_true(NOT gpc_record_scisure_workspace_decision(c,s,p,u,NULL,'finding-0','accepted',repeat('a',64),1),'revision CAS');
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL)->'decisions'='{}'::jsonb,'old revision decisions do not satisfy all-review requirement');
  -- A fallback identity cannot drift to a different immutable finding index.
  UPDATE gpc_analyses SET analysis_result=jsonb_set(fixture,'{recommendations,0}','{"cardKind":"warning","original":{"chemical":"Different"}}') WHERE id=a;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL) IS NULL,'fallback binding fails if canonical order/content is changed');
  UPDATE gpc_analyses SET analysis_result=fixture, user_id=other_u WHERE id=a;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL) IS NULL,'canonical analysis belongs to actual owner');
  UPDATE gpc_analyses SET user_id=u, source_snapshot_hash=repeat('b',64) WHERE id=a;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL) IS NULL,'canonical source binding enforced');
  UPDATE gpc_analyses SET source_snapshot_hash=repeat('a',64) WHERE id=a;
  UPDATE gpc_analysis_runs SET user_id=other_u WHERE id=r;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL) IS NULL,'run owner enforced');
  UPDATE gpc_analysis_runs SET user_id=u WHERE id=r;
  UPDATE gpc_scisure_connections SET expires_at=now()-interval '1 second' WHERE id=c;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL) IS NULL,'expired connection cannot read');
  PERFORM assert_true(NOT gpc_record_scisure_workspace_decision(c,s,p,u,NULL,'finding-0','accepted',repeat('a',64),2),'expired connection cannot write');
  UPDATE gpc_scisure_connections SET expires_at=now()+interval '67 minutes' WHERE id=c;
  UPDATE gpc_external_source_snapshots SET principal_id=(SELECT id FROM gpc_scisure_principals WHERE user_id='00000000-0000-0000-0000-000000000010') WHERE id=s;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL) IS NULL,'snapshot principal must agree with job/connection');
  UPDATE gpc_external_source_snapshots SET principal_id=p WHERE id=s;
  UPDATE gpc_scisure_jobs SET status='queued' WHERE id=j;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL)->'analysis'='null'::jsonb,'queued job returns no analysis');
  PERFORM assert_true(NOT gpc_record_scisure_workspace_decision(c,s,p,u,NULL,'finding-0','accepted',repeat('a',64),2),'queued job cannot accept a review');
  UPDATE gpc_scisure_jobs SET status='completed' WHERE id=j;
  UPDATE gpc_scisure_principals SET revoked_at=now() WHERE id=p;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,u,NULL) IS NULL,'revoked principal cannot read');
  UPDATE gpc_scisure_principals SET revoked_at=NULL WHERE id=p;
  -- Delete through existing purge; new raw records cascade, quota ledger is untouched.
  INSERT INTO gpc_scisure_quota_reservations(scope_key,job_id,state) VALUES ('fixture-scope',j,'completed');
  UPDATE gpc_scisure_jobs SET expires_at=now()-interval '1 second' WHERE id=j;
  UPDATE gpc_external_source_snapshots SET expires_at=now()-interval '1 second' WHERE id=s;
  PERFORM gpc_purge_expired_scisure_lineage();
  PERFORM assert_true(NOT EXISTS(SELECT 1 FROM gpc_scisure_workspace_decisions WHERE job_id=j),'workspace raw reviews purged with lineage');
  PERFORM assert_true(EXISTS(SELECT 1 FROM gpc_scisure_quota_reservations WHERE scope_key='fixture-scope' AND job_id IS NULL),'nonPII quota audit survives');
END $$;
DO $$
DECLARE subject uuid; p uuid; c uuid; s uuid; j uuid; admission uuid;
BEGIN
  INSERT INTO gpc_scisure_guest_subjects(subject_hash,expires_at) VALUES ('workspace-verified-subject',now()+interval '90 days') RETURNING id INTO subject;
  INSERT INTO gpc_scisure_principals(kind,guest_subject_id,expires_at) VALUES('guest',subject,now()+interval '1 hour') RETURNING id INTO p;
  INSERT INTO gpc_scisure_connections(principal_id,allowed_origin,nonce_hash,credential_id,credential_hash,expires_at)
    VALUES(p,'https://sandbox.elabjournal.com','guest-workspace-nonce','guest-workspace-credential','fixture',now()+interval '1 hour') RETURNING id INTO c;
  INSERT INTO gpc_external_source_snapshots(principal_id,connection_id,source_hash,source,protocol_text,expires_at)
    VALUES(p,c,repeat('c',64),'{}','Original guest text',now()+interval '90 days') RETURNING id INTO s;
  INSERT INTO gpc_scisure_jobs(principal_id,snapshot_id,idempotency_key,status,result,expires_at)
    VALUES(p,s,'guest-workspace-synthetic','completed','{"steps":[],"recommendations":[{"cardKind":"warning"}]}',now()+interval '90 days') RETURNING id INTO j;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,NULL,subject) IS NULL,'no verified guest admission is fail-closed');
  INSERT INTO gpc_scisure_guest_admissions(subject_id,token_hash,expires_at) VALUES(subject,'workspace-verified-admission',now()+interval '1 hour') RETURNING id INTO admission;
  PERFORM assert_true(gpc_record_scisure_workspace_decision(c,s,p,NULL,subject,'finding-0','accepted',repeat('c',64),0),'verified guest can acknowledge warnings');
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,NULL,subject)#>>'{decisions,finding-0}'='accepted','guest durable readback');
  PERFORM assert_true(NOT gpc_record_scisure_workspace_decision(c,s,p,NULL,subject,'finding-0','accepted',repeat('c',64),1),'guest immutable revision is zero');
  UPDATE gpc_scisure_guest_admissions SET revoked_at=now() WHERE id=admission;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,NULL,subject) IS NULL,'revoked verified admission fails closed');
  UPDATE gpc_scisure_guest_admissions SET revoked_at=NULL WHERE id=admission;
  UPDATE gpc_scisure_principals SET expires_at=now()-interval '1 second' WHERE id=p;
  PERFORM assert_true(gpc_get_scisure_workspace(c,s,p,NULL,subject) IS NULL,'expired guest identity fails closed');
  UPDATE gpc_scisure_principals SET expires_at=now()+interval '1 hour' WHERE id=p;
  UPDATE gpc_scisure_jobs SET expires_at=now()-interval '1 second' WHERE id=j;
  UPDATE gpc_external_source_snapshots SET expires_at=now()-interval '1 second' WHERE id=s;
  PERFORM gpc_purge_expired_scisure_lineage();
  PERFORM assert_true(NOT EXISTS(SELECT 1 FROM gpc_scisure_workspace_decisions WHERE job_id=j),'guest workspace reviews also cascade through raw purge');
END $$;
DO $$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['gpc_get_scisure_workspace(uuid,uuid,uuid,uuid,uuid)'::regprocedure,'gpc_record_scisure_workspace_decision(uuid,uuid,uuid,uuid,uuid,text,text,text,integer)'::regprocedure] LOOP
    PERFORM assert_true(NOT has_function_privilege('anon',f,'EXECUTE') AND NOT has_function_privilege('authenticated',f,'EXECUTE'),'no anon/authenticated/PUBLIC execution');
    PERFORM assert_true(has_function_privilege('service_role',f,'EXECUTE'),'only service_role RPC');
  END LOOP;
  PERFORM assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='gpc_scisure_workspace_decisions'::regclass),'RLS on workspace records');
  PERFORM assert_true(NOT has_table_privilege('anon','gpc_scisure_workspace_decisions','SELECT') AND NOT has_table_privilege('authenticated','gpc_scisure_workspace_decisions','INSERT'),'browser table privileges revoked');
  PERFORM assert_true((SELECT count(*) FROM pg_policy WHERE polrelid='gpc_scisure_workspace_decisions'::regclass)=0,'no browser RLS policies');
END $$;
SELECT 'PASS: private workspace all-findings, owner/run/source/revision CAS, guest verification, ACL and raw purge (synthetic fixtures)' AS result;
