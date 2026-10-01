-- Public partner inquiries and mail outbox are server-owned. No source/IP capture and no client DB access.
CREATE TABLE gpc_partner_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  email_hash TEXT NOT NULL CHECK (email_hash ~ '^[a-f0-9]{64}$'),
  organization TEXT CHECK (organization IS NULL OR char_length(organization) BETWEEN 2 AND 160),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 4000),
  privacy_acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gpc_partner_mail_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id UUID REFERENCES gpc_partner_inquiries(id) ON DELETE CASCADE,
  scisure_email_event_id UUID REFERENCES gpc_scisure_email_events(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('inquiry_notification', 'consensual_followup', 'guest_mailbox_verification', 'result_recovery')),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('pending_configuration', 'queued', 'leased', 'sent', 'suppressed', 'failed', 'uncertain')),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  provider_message_id TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  CHECK ((inquiry_id IS NOT NULL)::integer + (scisure_email_event_id IS NOT NULL)::integer = 1)
);
CREATE INDEX gpc_partner_inquiries_email_rate_idx ON gpc_partner_inquiries(email_hash, created_at DESC);
CREATE INDEX gpc_partner_mail_outbox_dispatch_idx ON gpc_partner_mail_outbox(state, created_at);

CREATE OR REPLACE FUNCTION gpc_submit_partner_inquiry(
  p_name TEXT, p_email TEXT, p_email_hash TEXT, p_organization TEXT, p_message TEXT, p_marketing_consent BOOLEAN
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_name IS NULL OR char_length(trim(p_name)) NOT BETWEEN 2 AND 120 OR p_email IS NULL OR char_length(trim(p_email)) NOT BETWEEN 3 AND 320
     OR p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p_email_hash !~ '^[a-f0-9]{64}$'
     OR p_message IS NULL OR char_length(trim(p_message)) NOT BETWEEN 10 AND 4000 OR (p_organization IS NOT NULL AND char_length(trim(p_organization)) NOT BETWEEN 2 AND 160) THEN
    RAISE EXCEPTION 'invalid partner inquiry';
  END IF;
  -- Rate limiting is identity-bound but does not retain a source/IP log.
  IF (SELECT count(*) FROM gpc_partner_inquiries WHERE email_hash=p_email_hash AND created_at > now()-interval '1 hour') >= 3 THEN
    RAISE EXCEPTION 'partner inquiry rate limit reached';
  END IF;
  INSERT INTO gpc_partner_inquiries(name,email,email_hash,organization,message,marketing_consent)
    VALUES(trim(p_name),lower(trim(p_email)),p_email_hash,NULLIF(trim(COALESCE(p_organization,'')),''),trim(p_message),p_marketing_consent) RETURNING id INTO v_id;
  INSERT INTO gpc_partner_mail_outbox(inquiry_id,purpose,idempotency_key)
    VALUES(v_id,'inquiry_notification','inquiry:' || replace(v_id::text,'-',''));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION gpc_lease_partner_mail(p_lease_seconds INTEGER DEFAULT 900)
RETURNS TABLE(outbox_id UUID, inquiry_id UUID, scisure_email_event_id UUID, purpose TEXT, lease_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_token UUID;
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  UPDATE gpc_partner_mail_outbox SET state='uncertain', lease_token=NULL, lease_expires_at=NULL, error_code='lease_expired_unknown_outcome'
    WHERE state='leased' AND lease_expires_at < now();
  SELECT id INTO v_id FROM gpc_partner_mail_outbox WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  v_token := gen_random_uuid();
  UPDATE gpc_partner_mail_outbox SET state='leased', lease_token=v_token, lease_expires_at=now()+make_interval(secs=>p_lease_seconds) WHERE id=v_id;
  RETURN QUERY SELECT id,inquiry_id,scisure_email_event_id,purpose,lease_token FROM gpc_partner_mail_outbox WHERE id=v_id;
END $$;

CREATE OR REPLACE FUNCTION gpc_finalize_partner_mail(p_outbox_id UUID,p_lease_token UUID,p_state TEXT,p_provider_message_id TEXT DEFAULT NULL,p_error_code TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_state NOT IN ('sent','failed','uncertain','pending_configuration','suppressed') THEN RAISE EXCEPTION 'invalid mail state'; END IF;
  IF p_state='sent' AND (p_provider_message_id IS NULL OR char_length(p_provider_message_id)=0) THEN RAISE EXCEPTION 'provider receipt required'; END IF;
  UPDATE gpc_partner_mail_outbox SET state=p_state,provider_message_id=p_provider_message_id,error_code=left(p_error_code,160),sent_at=CASE WHEN p_state='sent' THEN now() ELSE NULL END,lease_token=NULL,lease_expires_at=NULL
    WHERE id=p_outbox_id AND state='leased' AND lease_token=p_lease_token AND lease_expires_at>now();
  RETURN FOUND;
END $$;

ALTER TABLE gpc_partner_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_partner_mail_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION gpc_submit_partner_inquiry(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_lease_partner_mail(INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION gpc_finalize_partner_mail(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_submit_partner_inquiry(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN),gpc_lease_partner_mail(INTEGER),gpc_finalize_partner_mail(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;

-- Opaque one-time links are stored only as hashes. Safe GET renders confirmation; POST changes preference.
CREATE TABLE gpc_partner_mail_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scisure_email_event_id UUID NOT NULL REFERENCES gpc_scisure_email_events(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('guest_mailbox_verification', 'result_recovery', 'marketing')),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE gpc_partner_mail_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION gpc_queue_scisure_mail(p_event_id UUID,p_purpose TEXT,p_token_hash TEXT,p_expires_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_outbox UUID;
BEGIN
  IF p_purpose NOT IN ('guest_mailbox_verification','result_recovery') OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_expires_at <= now() OR p_expires_at > now()+interval '24 hours' THEN RAISE EXCEPTION 'invalid queued mail'; END IF;
  PERFORM 1 FROM gpc_scisure_email_events WHERE id=p_event_id AND purpose='delivery' AND state IN ('pending_configuration','queued');
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery event unavailable'; END IF;
  INSERT INTO gpc_partner_mail_tokens(scisure_email_event_id,purpose,token_hash,expires_at) VALUES(p_event_id,p_purpose,p_token_hash,p_expires_at);
  INSERT INTO gpc_partner_mail_outbox(scisure_email_event_id,purpose,idempotency_key) VALUES(p_event_id,p_purpose,'event:' || replace(p_event_id::text,'-','') || ':' || p_purpose) RETURNING id INTO v_outbox;
  RETURN v_outbox;
END $$;

CREATE OR REPLACE FUNCTION gpc_unsubscribe_scisure_marketing(p_token_hash TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event UUID;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  SELECT scisure_email_event_id INTO v_event FROM gpc_partner_mail_tokens WHERE token_hash=p_token_hash AND purpose='marketing' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
  IF v_event IS NULL THEN RETURN false; END IF;
  UPDATE gpc_partner_mail_tokens SET consumed_at=now() WHERE token_hash=p_token_hash;
  UPDATE gpc_scisure_email_events SET state='suppressed' WHERE id=v_event AND purpose='marketing';
  UPDATE gpc_partner_mail_outbox SET state='suppressed' WHERE scisure_email_event_id=v_event AND purpose='consensual_followup' AND state IN ('queued','pending_configuration');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION gpc_queue_scisure_mail(UUID,TEXT,TEXT,TIMESTAMPTZ),gpc_unsubscribe_scisure_marketing(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gpc_queue_scisure_mail(UUID,TEXT,TEXT,TIMESTAMPTZ),gpc_unsubscribe_scisure_marketing(TEXT) TO service_role;
