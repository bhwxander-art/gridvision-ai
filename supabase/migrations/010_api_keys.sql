-- API key management for external integrations
CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  key_hash    TEXT        NOT NULL UNIQUE,
  key_prefix  TEXT        NOT NULL,
  scopes      TEXT[]      NOT NULL DEFAULT ARRAY['read'],
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  request_count BIGINT    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS api_keys_tenant_id_idx ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys(key_hash) WHERE revoked_at IS NULL;
