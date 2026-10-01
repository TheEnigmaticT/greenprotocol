\set ON_ERROR_STOP on
-- Separate isolated acceptance for guest admission additions; baseline stays owned elsewhere.
\ir scisure-bridge.sql
\ir ../../supabase/migrations/20261001010000_add_scisure_guest_admission.sql
\ir ../../supabase/migrations/20261001020000_create_partner_inquiry_mail_outbox.sql

DO $$
DECLARE v_subject_id uuid; principal_id uuid; connection_id uuid; snapshot_id uuid; first_job uuid; replay_job uuid; second_job uuid;
BEGIN
  INSERT INTO gpc_scisure_guest_subjects(subject_hash, expires_at) VALUES ('a' || repeat('0',63), now()+interval '90 days') RETURNING id INTO v_subject_id;
  -- A stable subject, not a freshly issued token hash, owns the guest principal.
  INSERT INTO gpc_scisure_principals(kind, guest_subject_id, expires_at) VALUES ('guest', v_subject_id, now()+interval '90 days') RETURNING id INTO principal_id;
  INSERT INTO gpc_scisure_connections(principal_id,allowed_origin,nonce_hash,credential_id,credential_hash,expires_at)
    VALUES (principal_id,'https://sandbox.scisure.test','guest-nonce','guest-credential','guest-secret',now()+interval '10 minutes') RETURNING id INTO connection_id;
  INSERT INTO gpc_external_source_snapshots(principal_id,connection_id,source_hash,source,protocol_text,expires_at)
    VALUES (principal_id,connection_id,'guest-subject-source','{}','Add water.',now()+interval '90 days') RETURNING id INTO snapshot_id;

  SELECT job_id INTO first_job FROM gpc_reserve_scisure_guest_job(v_subject_id,principal_id,snapshot_id,'guest-subject-request',1);
  SELECT job_id INTO replay_job FROM gpc_reserve_scisure_guest_job(v_subject_id,principal_id,snapshot_id,'guest-subject-request',1);
  PERFORM assert_true(first_job = replay_job, 'guest reservation must be idempotent without consuming another allowance');
  BEGIN
    SELECT job_id INTO second_job FROM gpc_reserve_scisure_guest_job(v_subject_id,principal_id,snapshot_id,'guest-subject-request-2',1);
    RAISE EXCEPTION 'guest allowance reset or duplicate job admitted';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'guest allowance reset or duplicate job admitted' THEN RAISE; END IF;
  END;
  PERFORM assert_true(EXISTS(SELECT 1 FROM gpc_scisure_jobs WHERE id=first_job AND status='queued'), 'job must be created in the same guest reservation transaction');
  PERFORM assert_true((SELECT count(*) FROM gpc_scisure_guest_subject_reservations r WHERE r.subject_id=v_subject_id)=1, 'subject allowance must be reserved exactly once');
END $$;

DO $$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['gpc_reserve_scisure_guest_job(uuid,uuid,uuid,text,integer)'::regprocedure,'gpc_claim_scisure_guest_result(uuid,uuid,uuid)'::regprocedure] LOOP
    PERFORM assert_true(NOT has_function_privilege('anon',f,'EXECUTE'), 'anon must not execute guest security definer RPC');
    PERFORM assert_true(NOT has_function_privilege('authenticated',f,'EXECUTE'), 'authenticated must not execute guest security definer RPC');
    PERFORM assert_true(has_function_privilege('service_role',f,'EXECUTE'), 'service role must execute guest security definer RPC');
  END LOOP;
END $$;
SELECT 'scisure guest admission SQL acceptance passed' AS result;
