-- Durable, server-owned guest mail. Payloads are AES-256-GCM envelopes; no bearer token or email is stored in plaintext.
ALTER TABLE gpc_partner_mail_outbox ADD COLUMN guest_subject_id UUID REFERENCES gpc_scisure_guest_subjects(id) ON DELETE CASCADE;
ALTER TABLE gpc_partner_mail_outbox ADD COLUMN encrypted_payload TEXT;
ALTER TABLE gpc_partner_mail_outbox ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE gpc_partner_mail_outbox DROP CONSTRAINT gpc_partner_mail_outbox_purpose_check;
ALTER TABLE gpc_partner_mail_outbox ADD CONSTRAINT gpc_partner_mail_outbox_purpose_check CHECK (purpose IN ('inquiry_notification', 'consensual_followup', 'guest_mailbox_verification', 'result_recovery', 'admission', 'recovery'));
ALTER TABLE gpc_partner_mail_outbox DROP CONSTRAINT gpc_partner_mail_outbox_check;
ALTER TABLE gpc_partner_mail_outbox ADD CONSTRAINT gpc_partner_mail_outbox_target_check CHECK (
  (inquiry_id IS NOT NULL)::integer + (scisure_email_event_id IS NOT NULL)::integer + (guest_subject_id IS NOT NULL)::integer = 1
);
ALTER TABLE gpc_partner_mail_outbox ADD CONSTRAINT gpc_partner_mail_outbox_guest_payload_check CHECK (
  (guest_subject_id IS NULL AND encrypted_payload IS NULL AND expires_at IS NULL)
  OR (guest_subject_id IS NOT NULL AND encrypted_payload ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' AND expires_at IS NOT NULL)
);

CREATE OR REPLACE FUNCTION gpc_queue_scisure_guest_mail(p_subject_id UUID,p_purpose TEXT,p_encrypted_payload TEXT,p_expires_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_outbox UUID;
BEGIN
  IF p_purpose NOT IN ('admission','recovery') OR p_encrypted_payload !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' OR p_expires_at <= now() OR p_expires_at > now()+interval '24 hours' THEN RAISE EXCEPTION 'invalid guest mail outbox request'; END IF;
  PERFORM 1 FROM gpc_scisure_guest_subjects WHERE id=p_subject_id AND expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'guest subject unavailable'; END IF;
  INSERT INTO gpc_partner_mail_outbox(guest_subject_id,purpose,idempotency_key,encrypted_payload,expires_at)
    VALUES(p_subject_id,p_purpose,'guest:' || replace(gen_random_uuid()::text,'-',''),p_encrypted_payload,p_expires_at) RETURNING id INTO v_outbox;
  UPDATE gpc_scisure_guest_email_events SET state='queued' WHERE subject_id=p_subject_id AND purpose=p_purpose;
  RETURN v_outbox;
END $$;

DROP FUNCTION gpc_lease_partner_mail(INTEGER);
CREATE OR REPLACE FUNCTION gpc_lease_partner_mail(p_lease_seconds INTEGER DEFAULT 900)
RETURNS TABLE(outbox_id UUID, inquiry_id UUID, scisure_email_event_id UUID, guest_subject_id UUID, purpose TEXT, encrypted_payload TEXT, expires_at TIMESTAMPTZ, lease_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_token UUID;
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  UPDATE gpc_partner_mail_outbox SET state='uncertain', lease_token=NULL, lease_expires_at=NULL, error_code='lease_expired_unknown_outcome' WHERE state='leased' AND lease_expires_at < now();
  SELECT id INTO v_id FROM gpc_partner_mail_outbox WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  v_token := gen_random_uuid();
  UPDATE gpc_partner_mail_outbox SET state='leased', lease_token=v_token, lease_expires_at=now()+make_interval(secs=>p_lease_seconds) WHERE id=v_id;
  RETURN QUERY SELECT id,inquiry_id,scisure_email_event_id,guest_subject_id,purpose,encrypted_payload,expires_at,lease_token FROM gpc_partner_mail_outbox WHERE id=v_id;
END $$;
REVOKE ALL ON FUNCTION gpc_queue_scisure_guest_mail(UUID,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_queue_scisure_guest_mail(UUID,TEXT,TEXT,TIMESTAMPTZ) TO service_role;
