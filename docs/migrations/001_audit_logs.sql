-- Migration: Create audit_logs table
-- Purpose: Track user actions for compliance and debugging
-- Run this in Supabase SQL Editor or via migrations CLI

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action varchar(50) not null,
  resource_type varchar(50) not null,
  resource_id varchar(255),
  changes jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamp with time zone default now()
);

-- Create indexes for common queries
create index idx_audit_logs_tenant_id on audit_logs(tenant_id);
create index idx_audit_logs_user_id on audit_logs(user_id);
create index idx_audit_logs_created_at on audit_logs(created_at desc);
create index idx_audit_logs_tenant_created on audit_logs(tenant_id, created_at desc);

-- Enable RLS
alter table audit_logs enable row level security;

-- Policy: Users can only view audit logs from their tenant
create policy audit_logs_tenant_isolation
  on audit_logs for select
  using (tenant_id = auth.jwt() ->> 'tenant_id'::text);

-- Super admin policy: bypass tenant isolation
create policy audit_logs_admin_bypass
  on audit_logs for select
  using (
    exists (
      select 1 from users
      where users.id = auth.uid()
      and users.is_super_admin = true
    )
  );

-- Grant permissions
grant select on audit_logs to anon, authenticated;
grant select, insert on audit_logs to service_role;
