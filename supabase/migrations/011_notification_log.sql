-- Notification delivery log
CREATE TABLE IF NOT EXISTS notification_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,
  channel     TEXT        NOT NULL CHECK (channel IN ('email', 'slack', 'teams')),
  status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  recipient   TEXT,
  subject     TEXT,
  error       TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_log_tenant_id_idx ON notification_log(tenant_id, created_at DESC);
