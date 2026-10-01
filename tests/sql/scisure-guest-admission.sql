\set ON_ERROR_STOP on
-- Separate isolated acceptance for guest admission additions; baseline stays owned elsewhere.
\ir scisure-bridge.sql
\ir ../../supabase/migrations/20261001010000_add_scisure_guest_admission.sql
\ir ../../supabase/migrations/20261001020000_create_partner_inquiry_mail_outbox.sql
\ir ../../supabase/migrations/20261001040000_add_encrypted_guest_mail_outbox.sql
\ir ../../supabase/migrations/20261001030000_harden_scisure_registered_admission_and_review.sql
\ir ../../supabase/migrations/20261001050000_record_mail_acceptance_not_delivery.sql

DO $$
DECLARE v_subject_id uuid; foreign_subject_id uuid; principal_id uuid; connection_id uuid; snapshot_id uuid; first_job uuid; replay_job uuid; second_job uuid; guest_outbox uuid; accepted_outbox uuid; acceptance_lease uuid;
BEGIN
  INSERT INTO gpc_scisure_guest_subjects(subject_hash, expires_at) VALUES ('a' || repeat('0',63), now()+interval '90 days') RETURNING id INTO v_subject_id;
  SELECT gpc_queue_scisure_guest_mail(v_subject_id,'admission','v1.abc.def.ghi',now()+interval '15 minutes') INTO guest_outbox;
  PERFORM assert_true(EXISTS(SELECT 1 FROM gpc_partner_mail_outbox WHERE id=guest_outbox AND guest_subject_id=v_subject_id AND encrypted_payload='v1.abc.def.ghi' AND expires_at>now()), 'guest mail must persist only an encrypted payload in the shared durable outbox');
  SELECT outbox_id, lease_token INTO accepted_outbox, acceptance_lease FROM gpc_lease_partner_mail(900);
  PERFORM assert_true(accepted_outbox=guest_outbox, 'queued guest message must lease once for compare-and-swap finalization');
  PERFORM assert_true(gpc_finalize_partner_mail(accepted_outbox,acceptance_lease,'accepted','smtp-fixture-message-id',NULL), 'SMTP receipt must finalize as provider acceptance');
  PERFORM assert_true((SELECT state='accepted' AND provider_message_id='smtp-fixture-message-id' FROM gpc_partner_mail_outbox WHERE id=guest_outbox), 'mail outbox must not claim inbox delivery from an SMTP receipt');
  -- A stable subject, not a freshly issued token hash, owns the guest principal.
  INSERT INTO gpc_scisure_principals(kind, guest_subject_id, expires_at) VALUES ('guest', v_subject_id, now()+interval '90 days') RETURNING id INTO principal_id;
  INSERT INTO gpc_scisure_connections(principal_id,allowed_origin,nonce_hash,credential_id,credential_hash,expires_at)
    VALUES (principal_id,'https://sandbox.scisure.test','guest-nonce','guest-credential','guest-secret',now()+interval '10 minutes') RETURNING id INTO connection_id;
  INSERT INTO gpc_external_source_snapshots(principal_id,connection_id,source_hash,source,protocol_text,expires_at)
    VALUES (principal_id,connection_id,repeat('a',64),'{"selection":[{"stepId":"guest-step-1","order":1}]}','Add water.',now()+interval '90 days') RETURNING id INTO snapshot_id;

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
  UPDATE gpc_scisure_jobs SET status='completed', result='{"recommendations":[{"id":"guest-rec-safe","stepNumber":1,"cardKind":"swap","evidenceAssessment":{"eligibleForApplication":true}}]}'::jsonb, completed_at=now() WHERE id=first_job;
  INSERT INTO gpc_scisure_guest_subjects(subject_hash, expires_at) VALUES ('b' || repeat('0',63), now()+interval '90 days') RETURNING id INTO foreign_subject_id;
  PERFORM assert_true(gpc_record_scisure_guest_review_decision(snapshot_id,principal_id,v_subject_id,'guest-rec-safe','approved_for_experiment',repeat('a',64)), 'guest review must require and accept the server-derived owning subject proof');
  PERFORM assert_true(NOT gpc_record_scisure_guest_review_decision(snapshot_id,principal_id,foreign_subject_id,'guest-rec-safe','rejected',repeat('a',64)), 'foreign subject must not review an existing guest result');
  PERFORM assert_true(NOT gpc_record_scisure_guest_review_decision(snapshot_id,principal_id,v_subject_id,'guest-rec-other','approved_for_experiment',repeat('a',64)), 'guest review must prove recommendation eligibility from the completed result');
  PERFORM assert_true(EXISTS(SELECT 1 FROM gpc_scisure_review_decisions WHERE job_id=first_job AND recommendation_id='guest-rec-safe' AND reviewer_principal_id=principal_id AND reviewer_user_id IS NULL), 'guest decision must persist the guest principal rather than a claimed account');
  PERFORM gpc_claim_scisure_guest_result(v_subject_id,'00000000-0000-0000-0000-000000000010',first_job);
  PERFORM assert_true(EXISTS(SELECT 1 FROM gpc_scisure_guest_claims WHERE subject_id=v_subject_id AND user_id='00000000-0000-0000-0000-000000000010' AND job_id=first_job), 'claim must persist only the owning subject and authenticated account');
  BEGIN
    PERFORM gpc_claim_scisure_guest_result(foreign_subject_id,'00000000-0000-0000-0000-000000000010',first_job);
    RAISE EXCEPTION 'foreign subject claimed an existing result';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'foreign subject claimed an existing result' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['gpc_reserve_scisure_guest_job(uuid,uuid,uuid,text,integer)'::regprocedure,'gpc_claim_scisure_guest_result(uuid,uuid,uuid)'::regprocedure,'gpc_record_scisure_guest_review_decision(uuid,uuid,uuid,text,text,text)'::regprocedure] LOOP
    PERFORM assert_true(NOT has_function_privilege('anon',f,'EXECUTE'), 'anon must not execute guest security definer RPC');
    PERFORM assert_true(NOT has_function_privilege('authenticated',f,'EXECUTE'), 'authenticated must not execute guest security definer RPC');
    PERFORM assert_true(has_function_privilege('service_role',f,'EXECUTE'), 'service role must execute guest security definer RPC');
  END LOOP;
END $$;
SELECT 'scisure guest admission SQL acceptance passed' AS result;
