CREATE TABLE gpc_operational_alert_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  window_ending DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gpc_operational_alert_dispatches_type_window_unique
    UNIQUE (alert_type, window_ending)
);

ALTER TABLE gpc_operational_alert_dispatches ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE gpc_operational_alert_dispatches IS
  'Exactly-once ledger for scheduled operational Slack alerts.';
