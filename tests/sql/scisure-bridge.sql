\set ON_ERROR_STOP on
-- Isolated PostgreSQL acceptance for the actual SciSure migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
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
CREATE TABLE public.gpc_analysis_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), analysis_id uuid REFERENCES public.gpc_analyses(id) ON DELETE CASCADE,
  analysis_run_id uuid REFERENCES public.gpc_analysis_runs(id) ON DELETE SET NULL, user_id uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE public.gpc_dedup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), analysis_id uuid REFERENCES public.gpc_analyses(id) ON DELETE CASCADE,
  analysis_run_id uuid REFERENCES public.gpc_analysis_runs(id) ON DELETE SET NULL, user_id uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE public.gpc_canonical_scoring_snapshots (user_id uuid NOT NULL REFERENCES auth.users(id), protocol_fingerprint text NOT NULL, snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, protocol_fingerprint));
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
\ir ../../supabase/migrations/20261001000000_create_scisure_bridge.sql

CREATE OR REPLACE FUNCTION assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT condition THEN RAISE EXCEPTION '%', message; END IF; END $$;
DO $$
DECLARE guest uuid := '00000000-0000-0000-0000-000000000001'; other_guest uuid := '00000000-0000-0000-0000-000000000002'; registered uuid := '00000000-0000-0000-0000-000000000003'; u uuid := '00000000-0000-0000-0000-000000000010'; c uuid; snap uuid; job uuid; stale uuid; leased uuid; regc uuid; regsnap uuid; regjob uuid; duplicate uuid; ordinary_run uuid; scisure_run uuid;
BEGIN
  INSERT INTO auth.users VALUES (u, 'chemist@example.test');
  INSERT INTO gpc_scisure_principals(id, kind, guest_token_hash, expires_at) VALUES (guest,'guest','guest-hash',now()+interval '90 days'), (other_guest,'guest','other-hash',now()+interval '90 days');
  INSERT INTO gpc_scisure_principals(id, kind, user_id) VALUES (registered,'registered',u);
  INSERT INTO gpc_scisure_connections(principal_id,owner_user_id,allowed_origin,nonce_hash,credential_id,credential_hash,expires_at) VALUES (registered,u,'https://sandbox.scisure.test','nonce-reg','credential-reg','secret-reg',now()+interval '10 minutes') RETURNING id INTO regc;
  INSERT INTO gpc_external_source_snapshots(principal_id,connection_id,source_hash,source,protocol_text,expires_at) VALUES (registered,regc,'source-reg','{}','Add ethanol.',now()+interval '90 days') RETURNING id INTO regsnap;
  SELECT job_id INTO regjob FROM gpc_reserve_scisure_job(registered,regsnap,'registered-request',10);
  SELECT job_id INTO duplicate FROM gpc_reserve_scisure_job(registered,regsnap,'registered-request',10);
  PERFORM assert_true(regjob=duplicate, 'same idempotency key must not spend quota twice');
  INSERT INTO gpc_analysis_runs(user_id,status,run_source) VALUES(u,'running','scisure') RETURNING id INTO scisure_run;
  UPDATE gpc_scisure_jobs SET analysis_run_id=scisure_run,status='running' WHERE id=regjob;
  SELECT gpc_reserve_registered_analysis_run(u,2,'human') INTO ordinary_run;
  PERFORM assert_true(ordinary_run IS NOT NULL, 'linked SciSure audit run must not double-count the reservation');
  UPDATE gpc_analysis_runs SET status='completed', completed_at=now() WHERE id=ordinary_run;
  BEGIN PERFORM gpc_reserve_registered_analysis_run(u,1,'human'); RAISE EXCEPTION 'ordinary run bypassed active SciSure reservation'; EXCEPTION WHEN others THEN IF SQLERRM = 'ordinary run bypassed active SciSure reservation' THEN RAISE; END IF; END;
  UPDATE gpc_scisure_quota_reservations SET state='released' WHERE job_id=regjob;
  UPDATE gpc_scisure_jobs SET status='failed', completed_at=now() WHERE id=regjob;
  SELECT gpc_reserve_registered_analysis_run(u,1,'human') INTO ordinary_run;
  PERFORM assert_true(ordinary_run IS NOT NULL, 'ordinary transactional reservation should create the run after release');
  INSERT INTO gpc_scisure_connections(principal_id,allowed_origin,nonce_hash,credential_id,credential_hash,expires_at) VALUES (guest,'https://sandbox.scisure.test','nonce','credential-a','secret',now()-interval '1 minute') RETURNING id INTO c;
  INSERT INTO gpc_external_source_snapshots(principal_id,connection_id,source_hash,source,protocol_text,expires_at) VALUES (guest,c,'source-a','{}','Add water.',now()+interval '90 days') RETURNING id INTO snap;
  SELECT job_id INTO job FROM gpc_reserve_scisure_job(guest,snap,'request-a',10);
  PERFORM assert_true(job IS NOT NULL, 'guest reservation should succeed');
  UPDATE gpc_scisure_jobs SET status='completed', completed_at=now() WHERE id=job;
  UPDATE gpc_scisure_quota_reservations SET state='completed' WHERE job_id=job;
  PERFORM assert_true((SELECT count(*) FROM gpc_scisure_quota_reservations WHERE scope_key LIKE 'guest:%' AND state='completed')=1, 'completed guest entitlement must remain countable');
  BEGIN PERFORM gpc_reserve_scisure_job(other_guest,snap,'forged-snapshot',10); RAISE EXCEPTION 'cross-principal snapshot was accepted'; EXCEPTION WHEN others THEN IF SQLERRM = 'cross-principal snapshot was accepted' THEN RAISE; END IF; END;
  INSERT INTO gpc_scisure_jobs(principal_id,snapshot_id,idempotency_key,status,expires_at,lease_expires_at) VALUES (guest,snap,'stale','running',now()+interval '90 days',now()-interval '1 second') RETURNING id INTO stale;
  SELECT job_id INTO leased FROM gpc_lease_scisure_job(900);
  PERFORM assert_true(leased IS NULL, 'expired running lease must become uncertain, never auto-released');
  PERFORM assert_true((SELECT status='uncertain' FROM gpc_scisure_jobs WHERE id=stale), 'stale lease must be durable uncertain');
  UPDATE gpc_external_source_snapshots SET expires_at=now()-interval '1 second' WHERE id=snap;
  UPDATE gpc_scisure_jobs SET expires_at=now()-interval '1 second' WHERE snapshot_id=snap;
  PERFORM gpc_purge_expired_scisure_lineage();
  PERFORM assert_true(NOT EXISTS(SELECT 1 FROM gpc_external_source_snapshots WHERE id=snap), 'expired raw snapshot must purge after jobs');
  PERFORM assert_true(EXISTS(SELECT 1 FROM gpc_scisure_quota_reservations WHERE scope_key LIKE 'guest:%' AND state='completed'), 'purge must retain non-PII guest entitlement');
END $$;
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-000000000010'; r uuid; a uuid; j uuid; s uuid;
BEGIN
  SELECT id,snapshot_id INTO j,s FROM gpc_scisure_jobs WHERE idempotency_key='registered-request';
  INSERT INTO gpc_analysis_runs(user_id,status,run_source) VALUES(u,'completed','scisure') RETURNING id INTO r;
  INSERT INTO gpc_analyses(user_id,protocol_text,analysis_result) VALUES(u,'Add ethanol.','{}') RETURNING id INTO a;
  UPDATE gpc_scisure_jobs SET analysis_id=a,analysis_run_id=r,expires_at=now()-interval '1 second' WHERE id=j;
  UPDATE gpc_external_source_snapshots SET expires_at=now()-interval '1 second' WHERE id=s;
  INSERT INTO gpc_analysis_traces(analysis_run_id,user_id) VALUES(r,u);
  INSERT INTO gpc_dedup_log(analysis_run_id,user_id) VALUES(r,u);
  INSERT INTO gpc_canonical_scoring_snapshots(user_id,protocol_fingerprint,snapshot) VALUES(u,'unrelated-retained-protocol','{"title":"Keep this unrelated analysis"}');
  PERFORM gpc_purge_expired_scisure_lineage();
  PERFORM assert_true(NOT EXISTS(SELECT 1 FROM gpc_analysis_traces WHERE analysis_run_id=r),'purge must remove orphan run-linked traces');
  PERFORM assert_true(NOT EXISTS(SELECT 1 FROM gpc_dedup_log WHERE analysis_run_id=r),'purge must remove orphan run-linked dedup payloads');
  PERFORM assert_true(EXISTS(SELECT 1 FROM gpc_canonical_scoring_snapshots WHERE protocol_fingerprint='unrelated-retained-protocol'),'purge must not remove another protocol canonical snapshot');
END $$;
DO $$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['gpc_reserve_scisure_job(uuid,uuid,text,integer)'::regprocedure,'gpc_lease_scisure_job(integer)'::regprocedure,'gpc_purge_expired_scisure_lineage()'::regprocedure] LOOP
    PERFORM assert_true(NOT has_function_privilege('anon',f,'EXECUTE'), 'anon must not execute security definer RPC');
    PERFORM assert_true(NOT has_function_privilege('authenticated',f,'EXECUTE'), 'authenticated must not execute security definer RPC');
    PERFORM assert_true(has_function_privilege('service_role',f,'EXECUTE'), 'service_role must execute server RPC');
  END LOOP;
END $$;
SELECT 'scisure bridge SQL acceptance passed' AS result;
