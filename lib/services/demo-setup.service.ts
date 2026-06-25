import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TenantRepository } from "@/lib/db/repositories/tenant.repository";
import { createSubscription } from "@/lib/services/subscription.service";

// ── Demo Tenant Configuration ──────────────────────────────────────────────────

export const DEMO_TENANT_CONFIG = {
  name: "Demo Utility Co.",
  slug: "demo-utility",
  type: "utility" as const,
  plan: "professional" as const,
  settings: {
    companyName: "Demo Utility Co.",
    timezone: "America/New_York",
    defaultUnits: "metric",
    notificationEmail: "demo@gridvision.ai",
    logoUrl: "https://via.placeholder.com/200x50?text=Demo+Utility",
  },
};

// ── Demo Data Setup ────────────────────────────────────────────────────────────

export interface DemoData {
  tenantId: string;
  substations: Array<{ id: string; name: string; region: string }>;
  projects: Array<{ id: string; name: string; status: string }>;
  accounts: Array<{ id: string; name: string; type: string; stage: string }>;
  scenarios: Array<{ id: string; name: string }>;
}

export async function setupDemoTenant(
  client: SupabaseClient
): Promise<DemoData> {
  const tenantRepo = new TenantRepository(client);

  // Create or get demo tenant
  let demoTenant;
  try {
    // Try to fetch existing demo tenant
    const { data: existing } = await client
      .from("tenants")
      .select("id")
      .eq("slug", DEMO_TENANT_CONFIG.slug)
      .single();

    if (existing) {
      demoTenant = existing;
    } else {
      throw new Error("Not found");
    }
  } catch {
    // Create new demo tenant
    demoTenant = await tenantRepo.createTenant({
      name: DEMO_TENANT_CONFIG.name,
      slug: DEMO_TENANT_CONFIG.slug,
      type: DEMO_TENANT_CONFIG.type,
      plan: DEMO_TENANT_CONFIG.plan,
      status: "active",
      settings: DEMO_TENANT_CONFIG.settings,
    });

    // Create professional subscription
    await createSubscription(
      client,
      demoTenant.id,
      "professional",
      "annual",
      365 // Unlimited trial for demo
    );
  }

  // Seed demo data
  const demoData = await seedDemoData(client, demoTenant.id);

  return demoData;
}

async function seedDemoData(
  client: SupabaseClient,
  tenantId: string
): Promise<DemoData> {
  // Demo substations
  const substations = [
    {
      id: "demo-ss-boston",
      name: "Boston Downtown Substation",
      region: "New England",
      voltage_kv: 345,
      nameplate_mva: 500,
      peak_load_mw: 420,
      n1_capacity_mw: 180,
      annual_growth_pct: 3.2,
      latitude: 42.3601,
      longitude: -71.0589,
    },
    {
      id: "demo-ss-providence",
      name: "Providence North Substation",
      region: "New England",
      voltage_kv: 230,
      nameplate_mva: 350,
      peak_load_mw: 280,
      n1_capacity_mw: 120,
      annual_growth_pct: 2.8,
      latitude: 41.8240,
      longitude: -71.4128,
    },
    {
      id: "demo-ss-hartford",
      name: "Hartford Central Substation",
      region: "New England",
      voltage_kv: 138,
      nameplate_mva: 250,
      peak_load_mw: 200,
      n1_capacity_mw: 90,
      annual_growth_pct: 2.5,
      latitude: 41.7658,
      longitude: -72.6734,
    },
  ];

  // Upsert substations
  for (const ss of substations) {
    await client
      .from("substations")
      .upsert({ ...ss, tenant_id: tenantId }, { onConflict: "id" });
  }

  // Demo projects
  const projects = [
    {
      id: "demo-proj-boston-upgrade",
      substation_id: "demo-ss-boston",
      project_name: "Boston Downtown Transformer Upgrade",
      upgrade_type: "transformer-replacement",
      estimated_cost_usd: 2500000,
      added_capacity_mw: 120,
      implementation_months: 8,
      risk_reduction: 85,
      priority_score: 95,
      status: "approved",
      notes: "Critical capacity relief for downtown expansion",
    },
    {
      id: "demo-proj-providence-reconductor",
      substation_id: "demo-ss-providence",
      project_name: "Providence North Feeder Reconductoring",
      upgrade_type: "feeder-reconductor",
      estimated_cost_usd: 1200000,
      added_capacity_mw: 60,
      implementation_months: 6,
      risk_reduction: 65,
      priority_score: 78,
      status: "in-progress",
      notes: "Increases reliability and capacity for new development",
    },
  ];

  // Upsert projects
  for (const proj of projects) {
    await client
      .from("capital_projects")
      .upsert({ ...proj, tenant_id: tenantId }, { onConflict: "id" });
  }

  // Demo accounts (CRM)
  const accounts = [
    {
      id: "demo-acc-datacenter-1",
      tenant_id: tenantId,
      name: "TechHub Data Centers Phase 2",
      type: "data-center-developer",
      status: "proposal",
      annual_load_mw: 0,
      projected_growth_mw: 180,
      territory: "Boston Metro",
      estimated_revenue_usd: 450000,
      estimated_arr: 450000,
      deal_probability: 65,
      expected_close_date: "2026-09-30",
      forecast_quarter: "2026-Q3",
      capacity_required_mw: 200,
      priority: "high",
      risk_rating: "medium",
      contact_name: "Sarah Chen",
      contact_title: "VP Operations",
      notes: "Strong commitment, final permitting phase",
    },
    {
      id: "demo-acc-industrial-1",
      tenant_id: tenantId,
      name: "Boston Manufacturing Campus",
      type: "industrial-customer",
      status: "assessment",
      annual_load_mw: 0,
      projected_growth_mw: 45,
      territory: "Providence",
      estimated_revenue_usd: 180000,
      estimated_arr: 180000,
      deal_probability: 35,
      expected_close_date: "2027-03-31",
      forecast_quarter: "2027-Q1",
      capacity_required_mw: 50,
      priority: "medium",
      risk_rating: "high",
      contact_name: "John Martinez",
      contact_title: "Plant Director",
      notes: "Expansion depends on permitting timeline",
    },
    {
      id: "demo-acc-utility-1",
      tenant_id: tenantId,
      name: "Newport Utilities Joint Venture",
      type: "utility",
      status: "qualified",
      annual_load_mw: 0,
      projected_growth_mw: 250,
      territory: "Rhode Island",
      estimated_revenue_usd: 750000,
      estimated_arr: 750000,
      deal_probability: 45,
      expected_close_date: "2026-12-31",
      forecast_quarter: "2026-Q4",
      capacity_required_mw: 280,
      priority: "strategic",
      risk_rating: "medium",
      contact_name: "Dr. Robert Johnson",
      contact_title: "Chief Planning Officer",
      notes: "Large regional planning opportunity, multi-year engagement",
    },
  ];

  // Upsert accounts
  for (const acc of accounts) {
    await client.from("accounts").upsert(acc, { onConflict: "id" });
  }

  return {
    tenantId,
    substations: substations.map((ss) => ({
      id: ss.id,
      name: ss.name,
      region: ss.region,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.project_name,
      status: p.status,
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      stage: a.status,
    })),
    scenarios: [],
  };
}

// ── Demo Reset ─────────────────────────────────────────────────────────────────

export async function resetDemoTenant(
  client: SupabaseClient,
  tenantId: string
): Promise<void> {
  // Delete demo data (keep tenant and subscription)
  await Promise.all([
    client
      .from("audit_logs")
      .delete()
      .eq("tenant_id", tenantId),
    client
      .from("accounts")
      .delete()
      .eq("tenant_id", tenantId),
    client
      .from("scenarios")
      .delete()
      .eq("tenant_id", tenantId),
    client
      .from("capital_projects")
      .delete()
      .eq("tenant_id", tenantId),
    client
      .from("usage_records")
      .delete()
      .eq("tenant_id", tenantId),
  ]);

  // Re-seed demo data
  await seedDemoData(client, tenantId);
}

// ── Demo Detection ─────────────────────────────────────────────────────────────

export function isDemoTenant(tenantSlug: string): boolean {
  return tenantSlug === DEMO_TENANT_CONFIG.slug;
}

export function getDemoTenantId(
  tenants: Array<{ id: string; slug: string }>
): string | null {
  const demo = tenants.find((t) => t.slug === DEMO_TENANT_CONFIG.slug);
  return demo?.id ?? null;
}
