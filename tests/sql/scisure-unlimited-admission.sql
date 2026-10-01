\set ON_ERROR_STOP on
-- Reuse the security fixture, then apply the live schema-qualified quota RPC.
\ir scisure-registered-security.sql
CREATE SCHEMA extensions;
ALTER EXTENSION pgcrypto SET SCHEMA extensions;
\ir ../../supabase/migrations/20261001080000_fix_scisure_digest_qualified_path.sql
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-000000000099'; p uuid; c uuid; s uuid; j uuid; replay boolean;
BEGIN
  INSERT INTO auth.users VALUES (u,'trevor@greenchemistry.ai');
  INSERT INTO gpc_scisure_principals(kind,user_id) VALUES ('registered',u) RETURNING id INTO p;
  INSERT INTO gpc_scisure_connections(principal_id,owner_user_id,allowed_origin,nonce_hash,credential_id,credential_hash,expires_at)
    VALUES (p,u,'https://sandbox.elabjournal.com','unlimited-nonce','unlimited-credential','secret',now()+interval '10 minutes') RETURNING id INTO c;
  INSERT INTO gpc_external_source_snapshots(principal_id,connection_id,source_hash,source,protocol_text,expires_at)
    VALUES (p,c,repeat('e',64),'{}','Add water.',now()+interval '90 days') RETURNING id INTO s;
  INSERT INTO gpc_registered_analysis_quota_ledger(user_scope_hash,admission_key,state)
    SELECT encode(extensions.digest('user:' || u::text,'sha256'),'hex'),'unlimited-existing:' || n::text,'completed' FROM generate_series(1,12) n;
  BEGIN
    PERFORM gpc_reserve_scisure_job(p,s,'still-capped',10);
    RAISE EXCEPTION 'numeric quota incorrectly accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'analysis quota exhausted' THEN RAISE; END IF;
  END;
  SELECT job_id,replayed INTO j,replay FROM gpc_reserve_scisure_job(p,s,'verified-unlimited',NULL);
  PERFORM assert_true(j IS NOT NULL AND NOT replay,'NULL must allow an uncapped service-authorized reservation');
  PERFORM assert_true((SELECT count(*) FROM gpc_registered_analysis_quota_ledger WHERE job_id=j)=1,'unlimited admission still audited');
  SELECT replayed INTO replay FROM gpc_reserve_scisure_job(p,s,'verified-unlimited',NULL);
  PERFORM assert_true(replay,'unlimited admission remains idempotent');
  PERFORM assert_true(NOT has_function_privilege('anon','gpc_reserve_scisure_job(uuid,uuid,text,integer)','EXECUTE'),'anonymous clients cannot choose NULL allowance');
  PERFORM assert_true(NOT has_function_privilege('authenticated','gpc_reserve_scisure_job(uuid,uuid,text,integer)','EXECUTE'),'authenticated clients cannot choose NULL allowance');
END $$;
SELECT 'SciSure unlimited admission preserves quotas, idempotency, audit and service-only ACLs' AS result;
