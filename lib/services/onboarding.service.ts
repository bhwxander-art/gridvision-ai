import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TenantRepository } from "@/lib/db/repositories/tenant.repository";
import { createSubscription } from "@/lib/services/subscription.service";
import { logAuditEvent } from "@/lib/db/audit";
import type { PlanTier } from "@/lib/db/types-billing";

// ── Onboarding Request ─────────────────────────────────────────────────────────

export interface SignupRequest {
  companyName: string;
  contactEmail: string;
  plan: PlanTier;
  billingCycle: "monthly" | "annual";
}

export interface OnboardingResult {
  tenantId: string;
  adminUserId: string;
  subscriptionId: string;
  trialDaysRemaining: number;
  message: string;
}

// ── Customer Onboarding Flow ───────────────────────────────────────────────────

export async function onboardNewCustomer(
  client: SupabaseClient,
  request: SignupRequest
): Promise<OnboardingResult> {
  // Step 1: Create tenant
  const tenantRepo = new TenantRepository(client);
  const tenantSlug = request.companyName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 50);

  // Map subscription plan to tenant plan
  const tenantPlan: "professional" | "enterprise" = request.plan === "starter" ? "professional" : request.plan;

  const tenant = await tenantRepo.createTenant({
    name: request.companyName,
    slug: `${tenantSlug}-${Date.now()}`, // Ensure uniqueness
    type: "utility", // Default type for customers
    plan: tenantPlan,
    status: "active",
    settings: {
      notificationEmail: request.contactEmail,
      companyName: request.companyName,
    },
  });

  // Step 2: Create subscription
  const subscription = await createSubscription(
    client,
    tenant.id,
    request.plan,
    request.billingCycle
  );

  // Step 3: Log onboarding event
  await logAuditEvent(client, {
    tenantId: tenant.id,
    action: "tenant_create",
    resourceType: "tenant",
    resourceId: tenant.id,
    changes: {
      companyName: request.companyName,
      plan: request.plan,
      billingCycle: request.billingCycle,
      trialDaysRemaining: subscription.trial_end_date ?
        Math.ceil((new Date(subscription.trial_end_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : 0,
    },
  });

  // Step 4: Calculate trial days
  const trialDaysRemaining = subscription.trial_end_date ?
    Math.ceil((new Date(subscription.trial_end_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : 0;

  return {
    tenantId: tenant.id,
    adminUserId: "", // Would be created by auth flow
    subscriptionId: subscription.id,
    trialDaysRemaining,
    message: `Welcome to GridVision AI! Your ${request.plan} plan is activated with a ${trialDaysRemaining}-day trial.`,
  };
}

// ── Seeding Default Tenant Settings ────────────────────────────────────────────

export interface DefaultTenantSettings {
  timezone: string;
  defaultUnits: "metric" | "imperial";
  notificationEmail: string;
  companyName: string;
  logoUrl?: string;
  brandColor?: string;
}

export async function seedTenantDefaults(
  client: SupabaseClient,
  tenantId: string,
  settings: Partial<DefaultTenantSettings>
): Promise<void> {
  const defaults: DefaultTenantSettings = {
    timezone: "America/New_York",
    defaultUnits: "metric",
    notificationEmail: settings.notificationEmail ?? "noreply@gridvision.ai",
    companyName: settings.companyName ?? "GridVision Customer",
    ...settings,
  };

  const { error } = await client
    .from("tenants")
    .update({
      settings: defaults,
    })
    .eq("id", tenantId);

  if (error) {
    throw new Error(`Failed to seed tenant settings: ${error.message}`);
  }
}

// ── Trial-to-Paid Conversion ───────────────────────────────────────────────────

export async function convertTrialToActive(
  client: SupabaseClient,
  subscriptionId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string
): Promise<void> {
  const now = new Date();
  let currentPeriodEnd = new Date();
  currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

  const { error } = await client
    .from("subscriptions")
    .update({
      status: "active",
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      current_period_start: now.toISOString(),
      current_period_end: currentPeriodEnd.toISOString(),
      next_billing_date: currentPeriodEnd.toISOString(),
    })
    .eq("id", subscriptionId);

  if (error) {
    throw new Error(`Failed to convert trial: ${error.message}`);
  }
}

// ── Plan Recommendations (Based on Usage) ──────────────────────────────────────

export interface PlanRecommendation {
  currentPlan: PlanTier;
  recommendedPlan: PlanTier;
  reason: string;
  estimatedSavings?: number;
}

export async function getRecommendedPlan(
  client: SupabaseClient,
  tenantId: string
): Promise<PlanRecommendation | null> {
  // Get current subscription
  const { data: subscription, error: subError } = await client
    .from("subscriptions")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subError || !subscription) {
    return null;
  }

  const currentPlan = subscription.plan_tier;

  // Get current month usage
  const now = new Date();
  const { data: usage, error: usageError } = await client
    .from("usage_records")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("year", now.getFullYear())
    .eq("month", now.getMonth() + 1)
    .maybeSingle();

  if (usageError || !usage) {
    return null;
  }

  // Analyze if upgrade needed
  if (currentPlan === "starter") {
    // Check if Professional plan is needed
    if (usage.user_seats_used > 5 || usage.asset_records > 100 || usage.api_requests > 10000) {
      return {
        currentPlan: "starter",
        recommendedPlan: "professional",
        reason: "Your usage exceeds Starter plan limits. Professional offers 20x more capacity.",
        estimatedSavings: 0,
      };
    }
  }

  if (currentPlan === "professional") {
    // Check if Enterprise plan is needed
    if (usage.user_seats_used > 20 || usage.asset_records > 1000 || usage.api_requests > 100000) {
      return {
        currentPlan: "professional",
        recommendedPlan: "enterprise",
        reason: "Your usage exceeds Professional plan limits. Upgrade to Enterprise for unlimited capacity.",
        estimatedSavings: 0,
      };
    }
  }

  // Check for downgrade opportunity
  if (currentPlan === "enterprise") {
    if (usage.user_seats_used <= 20 && usage.asset_records <= 1000 && usage.api_requests <= 100000) {
      const profCost = 499 * 12;
      const entCost = 2499 * 12;
      return {
        currentPlan: "enterprise",
        recommendedPlan: "professional",
        reason: "Your usage no longer requires Enterprise tier. Professional plan would provide the same features.",
        estimatedSavings: entCost - profCost,
      };
    }
  }

  return null;
}
