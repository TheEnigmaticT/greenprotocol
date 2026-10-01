-- SMTP/API provider receipts establish handoff acceptance, not recipient inbox delivery.
ALTER TABLE gpc_partner_mail_outbox DROP CONSTRAINT gpc_partner_mail_outbox_state_check;
ALTER TABLE gpc_partner_mail_outbox ADD CONSTRAINT gpc_partner_mail_outbox_state_check CHECK (state IN ('pending_configuration', 'queued', 'leased', 'accepted', 'sent', 'suppressed', 'failed', 'uncertain'));
UPDATE gpc_partner_mail_outbox SET state='accepted' WHERE state='sent';
ALTER TABLE gpc_scisure_email_events DROP CONSTRAINT gpc_scisure_email_events_state_check;
ALTER TABLE gpc_scisure_email_events ADD CONSTRAINT gpc_scisure_email_events_state_check CHECK (state IN ('pending_configuration', 'queued', 'accepted', 'sent', 'suppressed', 'failed'));
UPDATE gpc_scisure_email_events SET state='accepted' WHERE state='sent';
ALTER TABLE gpc_partner_mail_outbox DROP CONSTRAINT gpc_partner_mail_outbox_state_check;
ALTER TABLE gpc_partner_mail_outbox ADD CONSTRAINT gpc_partner_mail_outbox_state_check CHECK (state IN ('pending_configuration', 'queued', 'leased', 'accepted', 'suppressed', 'failed', 'uncertain'));
ALTER TABLE gpc_scisure_email_events DROP CONSTRAINT gpc_scisure_email_events_state_check;
ALTER TABLE gpc_scisure_email_events ADD CONSTRAINT gpc_scisure_email_events_state_check CHECK (state IN ('pending_configuration', 'queued', 'accepted', 'suppressed', 'failed'));

-- Qualify columns that collide with RETURNS TABLE output variables in PL/pgSQL.
CREATE OR REPLACE FUNCTION gpc_lease_partner_mail(p_lease_seconds INTEGER DEFAULT 900)
RETURNS TABLE(outbox_id UUID, inquiry_id UUID, scisure_email_event_id UUID, guest_subject_id UUID, purpose TEXT, encrypted_payload TEXT, expires_at TIMESTAMPTZ, lease_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_token UUID;
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  UPDATE gpc_partner_mail_outbox SET state='uncertain', lease_token=NULL, lease_expires_at=NULL, error_code='lease_expired_unknown_outcome' WHERE state='leased' AND lease_expires_at < now();
  SELECT o.id INTO v_id FROM gpc_partner_mail_outbox AS o WHERE o.state='queued' ORDER BY o.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  v_token := gen_random_uuid();
  UPDATE gpc_partner_mail_outbox AS o SET state='leased', lease_token=v_token, lease_expires_at=now()+make_interval(secs=>p_lease_seconds) WHERE o.id=v_id;
  RETURN QUERY SELECT o.id,o.inquiry_id,o.scisure_email_event_id,o.guest_subject_id,o.purpose,o.encrypted_payload,o.expires_at,o.lease_token FROM gpc_partner_mail_outbox AS o WHERE o.id=v_id;
END $$;
REVOKE ALL ON FUNCTION gpc_lease_partner_mail(INTEGER) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION gpc_finalize_partner_mail(p_outbox_id UUID,p_lease_token UUID,p_state TEXT,p_provider_message_id TEXT DEFAULT NULL,p_error_code TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_state NOT IN ('accepted','failed','uncertain','pending_configuration','suppressed') THEN RAISE EXCEPTION 'invalid mail state'; END IF;
  IF p_state='accepted' AND (p_provider_message_id IS NULL OR char_length(p_provider_message_id)=0) THEN RAISE EXCEPTION 'provider receipt required'; END IF;
  UPDATE gpc_partner_mail_outbox SET state=p_state,provider_message_id=p_provider_message_id,error_code=left(p_error_code,160),sent_at=CASE WHEN p_state='accepted' THEN now() ELSE NULL END,lease_token=NULL,lease_expires_at=NULL
    WHERE id=p_outbox_id AND state='leased' AND lease_token=p_lease_token AND lease_expires_at>now();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION gpc_finalize_partner_mail(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;

-- Supabase grants EXECUTE to anon/authenticated by default. Reassert the complete
-- server-only SciSure RPC surface after the final CREATE OR REPLACE statements.
REVOKE ALL ON FUNCTION
  gpc_reserve_scisure_job(UUID,UUID,TEXT,INTEGER),
  gpc_reserve_registered_analysis_run(UUID,INTEGER,TEXT),
  gpc_lease_scisure_job(INTEGER),
  gpc_heartbeat_scisure_job(UUID,UUID,INTEGER),
  gpc_complete_scisure_job(UUID,UUID,UUID,UUID,JSONB),
  gpc_fail_scisure_job(UUID,UUID,TEXT,TEXT),
  gpc_purge_expired_scisure_lineage(),
  gpc_reserve_scisure_guest_job(UUID,UUID,UUID,TEXT,INTEGER),
  gpc_consume_scisure_guest_email_challenge(TEXT,TIMESTAMPTZ),
  gpc_reserve_scisure_guest_subject_trial(UUID,TEXT,INTEGER),
  gpc_scisure_guest_subject_remaining(UUID,INTEGER),
  gpc_claim_scisure_guest_result(UUID,UUID,UUID),
  gpc_submit_partner_inquiry(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN),
  gpc_lease_partner_mail(INTEGER),
  gpc_finalize_partner_mail(UUID,UUID,TEXT,TEXT,TEXT),
  gpc_queue_scisure_mail(UUID,TEXT,TEXT,TIMESTAMPTZ),
  gpc_unsubscribe_scisure_marketing(TEXT),
  gpc_sync_registered_quota_run_state(),
  gpc_record_scisure_review_decision(UUID,UUID,UUID,TEXT,TEXT,TEXT,INTEGER),
  gpc_record_scisure_guest_review_decision(UUID,UUID,UUID,TEXT,TEXT,TEXT),
  gpc_queue_scisure_guest_mail(UUID,TEXT,TEXT,TIMESTAMPTZ)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  gpc_reserve_scisure_job(UUID,UUID,TEXT,INTEGER),
  gpc_reserve_registered_analysis_run(UUID,INTEGER,TEXT),
  gpc_lease_scisure_job(INTEGER),
  gpc_heartbeat_scisure_job(UUID,UUID,INTEGER),
  gpc_complete_scisure_job(UUID,UUID,UUID,UUID,JSONB),
  gpc_fail_scisure_job(UUID,UUID,TEXT,TEXT),
  gpc_purge_expired_scisure_lineage(),
  gpc_reserve_scisure_guest_job(UUID,UUID,UUID,TEXT,INTEGER),
  gpc_consume_scisure_guest_email_challenge(TEXT,TIMESTAMPTZ),
  gpc_reserve_scisure_guest_subject_trial(UUID,TEXT,INTEGER),
  gpc_scisure_guest_subject_remaining(UUID,INTEGER),
  gpc_claim_scisure_guest_result(UUID,UUID,UUID),
  gpc_submit_partner_inquiry(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN),
  gpc_lease_partner_mail(INTEGER),
  gpc_finalize_partner_mail(UUID,UUID,TEXT,TEXT,TEXT),
  gpc_queue_scisure_mail(UUID,TEXT,TEXT,TIMESTAMPTZ),
  gpc_unsubscribe_scisure_marketing(TEXT),
  gpc_sync_registered_quota_run_state(),
  gpc_record_scisure_review_decision(UUID,UUID,UUID,TEXT,TEXT,TEXT,INTEGER),
  gpc_record_scisure_guest_review_decision(UUID,UUID,UUID,TEXT,TEXT,TEXT),
  gpc_queue_scisure_guest_mail(UUID,TEXT,TEXT,TIMESTAMPTZ)
TO service_role;
