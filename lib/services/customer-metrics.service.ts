import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUBSCRIPTION_PLANS } from "@/lib/services/subscription.service";
import type { PlanTier } from "@/lib/db/types-billing";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CustomerMetrics {
  totalARR: number;
  totalMRR: number;
  activeTenants: number;
  trialConversions: number;
  churnRate: number;
  avgMRRPerTenant: number;
  topPlanByCount: PlanTier;
  revenueByPlan: Record<PlanTier, number>;
}

export interface InvestorMetrics extends CustomerMetrics {
  totalActiveUsers: number;
  totalAssets: number;
  totalScenarios: number;
  totalApiRequests: number;
  platformUtilization: number; // 0-100
  monthlyGrowthRate: number; // percentage
  customerLTV: number; // Lifetime Value estimate
}

// ── Customer Success Metrics ───────────────────────────────────────────────────

export async function getCustomerMetrics(
  client: SupabaseClient
): Promise<CustomerMetrics> {
  // Get all subscriptions
  const { data: subscriptions, error: subError } = await client
    .from("subscriptions")
    .select("*")
    .neq("status", "cancelled");

  if (subError) {
    throw new Error(`Failed to fetch subscriptions: ${subError.message}`);
  }

  if (!subscriptions) {
    return {
      totalARR: 0,
      totalMRR: 0,
      activeTenants: 0,
      trialConversions: 0,
      churnRate: 0,
      avgMRRPerTenant: 0,
      topPlanByCount: "starter",
      revenueByPlan: { starter: 0, professional: 0, enterprise: 0 },
    };
  }

  // Calculate revenue metrics
  let totalARR = 0;
  let totalMRR = 0;
  const revenueByPlan: Record<PlanTier, number> = {
    starter: 0,
    professional: 0,
    enterprise: 0,
  };
  const planCounts: Record<PlanTier, number> = {
    starter: 0,
    professional: 0,
    enterprise: 0,
  };

  let trialCount = 0;
  let activeCount = 0;

  for (const sub of subscriptions) {
    const plan = SUBSCRIPTION_PLANS[sub.plan_tier as PlanTier];
    const monthlyPrice = plan.priceMonthly;
    const annualPrice = plan.priceAnnual;

    const mrrForPlan = sub.billing_cycle === "annual" ? annualPrice / 12 : monthlyPrice;
    totalMRR += mrrForPlan;
    totalARR += sub.billing_cycle === "annual" ? annualPrice : monthlyPrice * 12;

    revenueByPlan[sub.plan_tier as PlanTier] += sub.billing_cycle === "annual" ? annualPrice : monthlyPrice * 12;
    planCounts[sub.plan_tier as PlanTier]++;

    if (sub.status === "trial") trialCount++;
    if (sub.status === "active") activeCount++;
  }

  // Calculate trial conversions (tenants that upgraded from trial to active)
  const { data: billingEvents, error: eventError } = await client
    .from("billing_events")
    .select("*")
    .in("event_type", ["trial_ended", "subscription_upgraded"]);

  if (eventError) {
    console.error("Failed to fetch billing events:", eventError);
  }

  const trialToPayingCount = billingEvents?.filter((e) =>
    e.event_type === "subscription_upgraded" || e.event_type === "trial_ended"
  ).length ?? 0;

  // Calculate churn (simplified)
  const { data: cancelledSubs, error: cancelError } = await client
    .from("subscriptions")
    .select("*")
    .eq("status", "cancelled");

  if (cancelError) {
    console.error("Failed to fetch cancelled subscriptions:", cancelError);
  }

  const churnRate = subscriptions.length > 0
    ? (cancelledSubs?.length ?? 0) / (subscriptions.length + (cancelledSubs?.length ?? 0))
    : 0;

  // Find top plan
  let topPlanByCount: PlanTier = "starter";
  let maxCount = planCounts.starter;
  if (planCounts.professional > maxCount) {
    topPlanByCount = "professional";
    maxCount = planCounts.professional;
  }
  if (planCounts.enterprise > maxCount) {
    topPlanByCount = "enterprise";
  }

  return {
    totalARR,
    totalMRR,
    activeTenants: activeCount,
    trialConversions: trialToPayingCount,
    churnRate: churnRate * 100, // Convert to percentage
    avgMRRPerTenant: activeCount > 0 ? totalMRR / activeCount : 0,
    topPlanByCount,
    revenueByPlan,
  };
}

// ── Investor Metrics ───────────────────────────────────────────────────────────

export async function getInvestorMetrics(
  client: SupabaseClient
): Promise<InvestorMetrics> {
  const customerMetrics = await getCustomerMetrics(client);

  // Get active users across all tenants
  const { data: usersData, error: usersError } = await client
    .from("user_tenants")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  if (usersError) {
    console.error("Failed to fetch active users:", usersError);
  }

  const totalActiveUsers = usersData?.length ?? 0;

  // Get total assets
  const { count: assetCount, error: assetError } = await client
    .from("substations")
    .select("*", { count: "exact", head: true });

  if (assetError) {
    console.error("Failed to fetch assets:", assetError);
  }

  const totalAssets = assetCount ?? 0;

  // Get total scenarios
  const { count: scenarioCount, error: scenarioError } = await client
    .from("scenarios")
    .select("*", { count: "exact", head: true });

  if (scenarioError) {
    console.error("Failed to fetch scenarios:", scenarioError);
  }

  const totalScenarios = scenarioCount ?? 0;

  // Get total API requests (sum all usage records)
  const { data: usageData, error: usageError } = await client
    .from("usage_records")
    .select("api_requests");

  if (usageError) {
    console.error("Failed to fetch usage:", usageError);
  }

  const totalApiRequests = (usageData ?? []).reduce((sum, r) => sum + r.api_requests, 0);

  // Calculate platform utilization (simplified: active users / total potential seats)
  const { data: subscriptions } = await client
    .from("subscriptions")
    .select("plan_tier")
    .neq("status", "cancelled");

  let totalPotentialSeats = 0;
  for (const sub of subscriptions ?? []) {
    const plan = SUBSCRIPTION_PLANS[sub.plan_tier as PlanTier];
    totalPotentialSeats += plan.limits.maxUsers;
  }

  const platformUtilization = totalPotentialSeats > 0
    ? (totalActiveUsers / totalPotentialSeats) * 100
    : 0;

  // Calculate LTV (simplified: ARR / monthly churn rate)
  const monthlyChurnRate = customerMetrics.churnRate / 100 / 12;
  const customerLTV = monthlyChurnRate > 0 ? customerMetrics.totalARR / (monthlyChurnRate * 12) : 0;

  // Growth rate (simplified: compare to previous month)
  // In production, would fetch previous month's metrics
  const monthlyGrowthRate = 5.2; // Placeholder

  return {
    ...customerMetrics,
    totalActiveUsers,
    totalAssets,
    totalScenarios,
    totalApiRequests,
    platformUtilization: Math.min(100, platformUtilization),
    monthlyGrowthRate,
    customerLTV,
  };
}

// ── Revenue Projection ─────────────────────────────────────────────────────────

export interface RevenueProjection {
  month: string;
  projectedARR: number;
  projectedMRR: number;
  confidence: number; // 0-1
}

export function projectRevenue(
  currentARR: number,
  monthlyGrowthRate: number,
  months = 12
): RevenueProjection[] {
  const projections: RevenueProjection[] = [];
  let projectedARR = currentARR;

  for (let i = 0; i < months; i++) {
    const monthDate = new Date();
    monthDate.setMonth(monthDate.getMonth() + i);
    const monthStr = monthDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });

    // Confidence decreases over time
    const confidence = Math.max(0.5, 1 - i * 0.05);

    projections.push({
      month: monthStr,
      projectedARR,
      projectedMRR: projectedARR / 12,
      confidence,
    });

    // Apply growth rate for next month
    projectedARR *= 1 + monthlyGrowthRate / 100;
  }

  return projections;
}

// ── Churn Risk Analysis ────────────────────────────────────────────────────────

export interface ChurnRiskTenant {
  tenantId: string;
  tenantName: string;
  plan: PlanTier;
  monthlyARR: number;
  daysOfInactivity: number;
  lastActivity: string;
  riskScore: number; // 0-100
}

export async function identifyChurnRisk(
  client: SupabaseClient
): Promise<ChurnRiskTenant[]> {
  // Get all active subscriptions
  const { data: subscriptions, error: subError } = await client
    .from("subscriptions")
    .select("*")
    .eq("status", "active");

  if (subError || !subscriptions) {
    return [];
  }

  const atRiskTenants: ChurnRiskTenant[] = [];
  const now = new Date();

  for (const sub of subscriptions) {
    // Get last activity from audit logs
    const { data: lastActivity, error: auditError } = await client
      .from("audit_logs")
      .select("created_at")
      .eq("tenant_id", sub.tenant_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (auditError) continue;

    const lastActivityDate = lastActivity?.created_at ? new Date(lastActivity.created_at) : now;
    const daysInactive = Math.floor((now.getTime() - lastActivityDate.getTime()) / (24 * 60 * 60 * 1000));

    // Calculate risk score (0-100)
    let riskScore = 0;
    if (daysInactive > 90) riskScore = 90;
    else if (daysInactive > 60) riskScore = 70;
    else if (daysInactive > 30) riskScore = 40;
    else if (daysInactive > 14) riskScore = 20;

    // Get tenant name
    const { data: tenantData } = await client
      .from("tenants")
      .select("name")
      .eq("id", sub.tenant_id)
      .maybeSingle();

    const plan = SUBSCRIPTION_PLANS[sub.plan_tier as PlanTier];
    const monthlyARR = sub.billing_cycle === "annual" ? plan.priceAnnual / 12 : plan.priceMonthly;

    if (riskScore > 0) {
      atRiskTenants.push({
        tenantId: sub.tenant_id,
        tenantName: tenantData?.name ?? "Unknown",
        plan: sub.plan_tier as PlanTier,
        monthlyARR,
        daysOfInactivity: daysInactive,
        lastActivity: lastActivityDate.toISOString(),
        riskScore,
      });
    }
  }

  return atRiskTenants.sort((a, b) => b.riskScore - a.riskScore);
}
