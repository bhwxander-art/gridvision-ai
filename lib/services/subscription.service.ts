import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlanTier,
  BillingCycle,
  SubscriptionStatus,
  DbSubscription,
  DbInvoice,
  DbBillingEvent,
  BillingEventType,
  UsageMetrics,
} from "@/lib/db/types-billing";

// ── Subscription Plans (Hardcoded, can be moved to DB) ────────────────────────

export const SUBSCRIPTION_PLANS = {
  starter: {
    tier: "starter",
    name: "Starter",
    description: "Perfect for small teams getting started",
    priceMonthly: 99,
    priceAnnual: 990,
    trialDays: 14,
    limits: {
      maxUsers: 5,
      maxAssets: 100,
      maxScenarios: 50,
      maxMonthlyRequests: 10000,
      customBranding: false,
      customDomain: false,
      advancedAnalytics: false,
      apiAccess: false,
      supportTier: "email" as const,
    },
  },
  professional: {
    tier: "professional",
    name: "Professional",
    description: "For growing teams with advanced needs",
    priceMonthly: 499,
    priceAnnual: 4990,
    trialDays: 14,
    limits: {
      maxUsers: 20,
      maxAssets: 1000,
      maxScenarios: 500,
      maxMonthlyRequests: 100000,
      customBranding: true,
      customDomain: false,
      advancedAnalytics: true,
      apiAccess: true,
      supportTier: "priority" as const,
    },
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    description: "Custom solutions for large organizations",
    priceMonthly: 2499,
    priceAnnual: 24990,
    trialDays: 30,
    limits: {
      maxUsers: 999,
      maxAssets: 100000,
      maxScenarios: 10000,
      maxMonthlyRequests: 10000000,
      customBranding: true,
      customDomain: true,
      advancedAnalytics: true,
      apiAccess: true,
      supportTier: "dedicated" as const,
    },
  },
} as const;

// ── Subscription Management ────────────────────────────────────────────────────

export async function getSubscription(
  client: SupabaseClient,
  tenantId: string
): Promise<DbSubscription | null> {
  const { data, error } = await client
    .from("subscriptions")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch subscription: ${error.message}`);
  }

  return data;
}

export async function createSubscription(
  client: SupabaseClient,
  tenantId: string,
  plan: PlanTier,
  billingCycle: BillingCycle = "monthly",
  trialDays?: number
): Promise<DbSubscription> {
  const planDef = SUBSCRIPTION_PLANS[plan];
  const now = new Date();
  const trialEnd = new Date(now.getTime() + (trialDays ?? planDef.trialDays) * 24 * 60 * 60 * 1000);

  const { data, error } = await client
    .from("subscriptions")
    .insert({
      tenant_id: tenantId,
      plan_tier: plan,
      status: "trial",
      billing_cycle: billingCycle,
      trial_start_date: now.toISOString(),
      trial_end_date: trialEnd.toISOString(),
      stripe_subscription_id: null,
      stripe_customer_id: null,
      cancel_at_period_end: false,
      amount_paid_cents: 0,
      currency: "USD",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create subscription: ${error.message}`);
  }

  return data as DbSubscription;
}

export async function upgradeSubscription(
  client: SupabaseClient,
  subscriptionId: string,
  newPlan: PlanTier
): Promise<DbSubscription> {
  const { data, error } = await client
    .from("subscriptions")
    .update({ plan_tier: newPlan, status: "active" })
    .eq("id", subscriptionId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upgrade subscription: ${error.message}`);
  }

  return data as DbSubscription;
}

export async function cancelSubscription(
  client: SupabaseClient,
  subscriptionId: string,
  immediate = false
): Promise<DbSubscription> {
  const status = immediate ? "cancelled" : "active";
  const cancelledAt = immediate ? new Date().toISOString() : null;

  const { data, error } = await client
    .from("subscriptions")
    .update({
      status,
      cancel_at_period_end: !immediate,
      cancelled_at: cancelledAt,
    })
    .eq("id", subscriptionId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to cancel subscription: ${error.message}`);
  }

  return data as DbSubscription;
}

// ── Usage Tracking ─────────────────────────────────────────────────────────────

export async function recordUsageEvent(
  client: SupabaseClient,
  tenantId: string,
  eventType: "api_request" | "scenario_run" | "asset_record" | "user_seat",
  count = 1
): Promise<void> {
  const now = new Date();
  const { error } = await client.rpc("increment_usage_counter", {
    p_tenant_id: tenantId,
    p_year: now.getFullYear(),
    p_month: now.getMonth() + 1,
    p_event_type: eventType,
    p_count: count,
  });
  if (error) throw new Error(`Failed to record usage: ${error.message}`);
}

export async function getMonthlyUsage(
  client: SupabaseClient,
  tenantId: string,
  year: number,
  month: number
): Promise<UsageMetrics | null> {
  const { data, error } = await client
    .from("usage_records")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch usage: ${error.message}`);
  }

  if (!data) return null;

  return {
    api_requests: data.api_requests,
    scenario_runs: data.scenario_runs,
    asset_records: data.asset_records,
    user_seats_used: data.user_seats_used,
    storage_gb: data.storage_gb,
  };
}

// ── Billing Events ─────────────────────────────────────────────────────────────

export async function recordBillingEvent(
  client: SupabaseClient,
  tenantId: string,
  eventType: BillingEventType,
  details: Record<string, unknown>
): Promise<DbBillingEvent> {
  const { data, error } = await client
    .from("billing_events")
    .insert({
      tenant_id: tenantId,
      event_type: eventType,
      details,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to record billing event: ${error.message}`);
  }

  return data as DbBillingEvent;
}

// ── Limits Checking ────────────────────────────────────────────────────────────

export function checkUsageLimits(
  usage: UsageMetrics,
  subscription: DbSubscription
): { exceeded: boolean; violations: string[] } {
  const plan = SUBSCRIPTION_PLANS[subscription.plan_tier as PlanTier];
  const violations: string[] = [];

  if (usage.user_seats_used > plan.limits.maxUsers) {
    violations.push(`User limit exceeded: ${usage.user_seats_used} > ${plan.limits.maxUsers}`);
  }

  if (usage.asset_records > plan.limits.maxAssets) {
    violations.push(`Asset limit exceeded: ${usage.asset_records} > ${plan.limits.maxAssets}`);
  }

  if (usage.scenario_runs > plan.limits.maxScenarios) {
    violations.push(`Scenario limit exceeded: ${usage.scenario_runs} > ${plan.limits.maxScenarios}`);
  }

  if (usage.api_requests > plan.limits.maxMonthlyRequests) {
    violations.push(`API request limit exceeded: ${usage.api_requests} > ${plan.limits.maxMonthlyRequests}`);
  }

  return {
    exceeded: violations.length > 0,
    violations,
  };
}

// ── Trial Management ───────────────────────────────────────────────────────────

export function isTrialActive(subscription: DbSubscription): boolean {
  if (subscription.status !== "trial") return false;
  if (!subscription.trial_end_date) return false;

  const now = new Date();
  const trialEnd = new Date(subscription.trial_end_date);
  return now < trialEnd;
}

export function getTrialDaysRemaining(subscription: DbSubscription): number {
  if (!subscription.trial_end_date) return 0;

  const now = new Date();
  const trialEnd = new Date(subscription.trial_end_date);
  const diff = trialEnd.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}
