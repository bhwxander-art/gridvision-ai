-- Atomic usage increment function — eliminates TOCTOU race condition
CREATE OR REPLACE FUNCTION increment_usage_counter(
  p_tenant_id uuid,
  p_year int,
  p_month int,
  p_event_type text,
  p_count int DEFAULT 1
)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO usage_records (
    tenant_id, year, month,
    api_requests, scenario_runs, asset_records, user_seats_used,
    storage_gb, overage_charges_cents
  )
  VALUES (
    p_tenant_id, p_year, p_month,
    CASE WHEN p_event_type = 'api_request'  THEN p_count ELSE 0 END,
    CASE WHEN p_event_type = 'scenario_run' THEN p_count ELSE 0 END,
    CASE WHEN p_event_type = 'asset_record' THEN p_count ELSE 0 END,
    CASE WHEN p_event_type = 'user_seat'    THEN p_count ELSE 0 END,
    0, 0
  )
  ON CONFLICT (tenant_id, year, month)
  DO UPDATE SET
    api_requests     = usage_records.api_requests
                       + (CASE WHEN p_event_type = 'api_request'  THEN p_count ELSE 0 END),
    scenario_runs    = usage_records.scenario_runs
                       + (CASE WHEN p_event_type = 'scenario_run' THEN p_count ELSE 0 END),
    asset_records    = usage_records.asset_records
                       + (CASE WHEN p_event_type = 'asset_record' THEN p_count ELSE 0 END),
    user_seats_used  = usage_records.user_seats_used
                       + (CASE WHEN p_event_type = 'user_seat'    THEN p_count ELSE 0 END);
$$;
