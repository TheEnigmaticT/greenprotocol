\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TABLE public.gpc_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  protocol_text text NOT NULL, analysis_result jsonb NOT NULL, impact_delta jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  source_snapshot_hash text, revision_number integer NOT NULL DEFAULT 1
);
CREATE TABLE public.gpc_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  analysis_id uuid REFERENCES public.gpc_analyses(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('running','completed','failed')), run_source text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE public.gpc_analysis_traces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), analysis_id uuid, analysis_run_id uuid, user_id uuid NOT NULL);
CREATE TABLE public.gpc_dedup_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), analysis_id uuid, analysis_run_id uuid, user_id uuid NOT NULL);
CREATE TABLE public.gpc_canonical_scoring_snapshots (user_id uuid NOT NULL, protocol_fingerprint text NOT NULL, snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, protocol_fingerprint));
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
\ir ../../supabase/migrations/20261001000000_create_scisure_bridge.sql
\ir ../../supabase/migrations/20261001030000_harden_scisure_registered_admission_and_review.sql
CREATE OR REPLACE FUNCTION assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT condition THEN RAISE EXCEPTION '%', message; END IF; END $$;
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-000000000010'; principal uuid := '00000000-0000-0000-0000-000000000003'; conn uuid; snap uuid; job uuid; run_id uuid; persisted_analysis_id uuid;
BEGIN
  INSERT INTO auth.users VALUES (u, 'chemist@example.test');
  INSERT INTO gpc_scisure_principals(id, kind, user_id) VALUES (principal,'registered',u);
  INSERT INTO gpc_scisure_connections(principal_id,owner_user_id,allowed_origin,nonce_hash,credential_id,credential_hash,expires_at)
    VALUES (principal,u,'https://sandbox.scisure.test','nonce','credential','secret',now()+interval '10 minutes') RETURNING id INTO conn;
  INSERT INTO gpc_external_source_snapshots(principal_id,connection_id,source_hash,source,protocol_text,expires_at)
    VALUES (principal,conn,repeat('c',64),'{"selection":[{"stepId":"step-1","order":1}]}','Add water.',now()+interval '90 days') RETURNING id INTO snap;
  SELECT job_id INTO job FROM gpc_reserve_scisure_job(principal,snap,'review-atomic',10);
  INSERT INTO gpc_analysis_runs(user_id,status,run_source) VALUES (u,'completed','scisure') RETURNING id INTO run_id;
  INSERT INTO gpc_analyses(user_id,protocol_text,analysis_result,revision_number) VALUES (u,'Add water.','{"recommendations":[{"id":"rec-safe","stepNumber":1,"cardKind":"swap","evidenceAssessment":{"eligibleForApplication":true}}]}',1) RETURNING id INTO persisted_analysis_id;
  UPDATE gpc_scisure_jobs SET status='completed',analysis_id=persisted_analysis_id,analysis_run_id=run_id WHERE id=job;
  PERFORM assert_true(gpc_record_scisure_review_decision(snap,principal,u,'rec-safe','approved_for_experiment',repeat('c',64),1), 'current bound decision must succeed');
  UPDATE gpc_analyses SET revision_number=2 WHERE id=persisted_analysis_id;
  PERFORM assert_true(NOT gpc_record_scisure_review_decision(snap,principal,u,'rec-safe','rejected',repeat('c',64),1), 'stale revision must lose the atomic compare-and-swap');
  PERFORM assert_true(NOT gpc_record_scisure_review_decision(snap,principal,u,'rec-other','approved_for_experiment',repeat('c',64),2), 'RPC must prove recommendation eligibility');
  PERFORM assert_true(NOT gpc_record_scisure_review_decision(snap,principal,u,'rec-safe','rejected',repeat('d',64),2), 'RPC must bind source hash');
  PERFORM assert_true((SELECT count(*) FROM gpc_scisure_review_decisions WHERE job_id=job AND recommendation_id='rec-safe')=1, 'stale attempt must not write');
  PERFORM assert_true((SELECT count(*) FROM gpc_registered_analysis_quota_ledger WHERE user_scope_hash=encode(digest('user:' || u::text,'sha256'),'hex')) > 0, 'registered completed admissions must have durable hashed ledger');
END $$;
DO $$
DECLARE f regprocedure := 'gpc_record_scisure_review_decision(uuid,uuid,uuid,text,text,text,integer)'::regprocedure;
BEGIN
  PERFORM assert_true(NOT has_function_privilege('anon',f,'EXECUTE'), 'anon cannot execute decision RPC');
  PERFORM assert_true(NOT has_function_privilege('authenticated',f,'EXECUTE'), 'authenticated cannot execute decision RPC');
  PERFORM assert_true(has_function_privilege('service_role',f,'EXECUTE'), 'service role can execute decision RPC');
END $$;
SELECT 'scisure registered security SQL acceptance passed' AS result;
