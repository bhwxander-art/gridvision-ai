/**
 * Billing and subscription data types for GridVision AI SaaS
 */

// ── Subscription Plans ─────────────────────────────────────────────────────────

export type PlanTier = "starter" | "professional" | "enterprise";
export type BillingCycle = "monthly" | "annual";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled" | "paused";

export interface PlanLimits {
  maxUsers: number;
  maxAssets: number;
  maxScenarios: number;
  maxMonthlyRequests: number;
  customBranding: boolean;
  customDomain: boolean;
  advancedAnalytics: boolean;
  apiAccess: boolean;
  supportTier: "email" | "priority" | "dedicated";
}

export interface SubscriptionPlan {
  id: string;
  tier: PlanTier;
  name: string;
  description: string;
  limits: PlanLimits;
  priceMonthly: number;
  priceAnnual: number;
  trialDays: number;
  featured: boolean;
  created_at: string;
  updated_at: string;
}

// ── Tenant Subscriptions ───────────────────────────────────────────────────────

export interface DbSubscription {
  id: string;
  tenant_id: string;
  plan_tier: PlanTier;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  trial_start_date: string | null;
  trial_end_date: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  next_billing_date: string | null;
  amount_paid_cents: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

// ── Usage Metering ─────────────────────────────────────────────────────────────

export interface UsageMetrics {
  api_requests: number;
  scenario_runs: number;
  asset_records: number;
  user_seats_used: number;
  storage_gb: number;
}

export interface DbUsageRecord {
  id: string;
  tenant_id: string;
  year: number;
  month: number;
  api_requests: number;
  scenario_runs: number;
  asset_records: number;
  user_seats_used: number;
  storage_gb: number;
  overage_charges_cents: number;
  created_at: string;
}

export type DbUsageRecordInsert = Omit<DbUsageRecord, "id" | "created_at">;

// ── Invoices ───────────────────────────────────────────────────────────────────

export interface DbInvoice {
  id: string;
  tenant_id: string;
  subscription_id: string;
  stripe_invoice_id: string | null;
  amount_cents: number;
  currency: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  invoice_date: string;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
}

export type DbInvoiceInsert = Omit<DbInvoice, "id" | "created_at">;

// ── Billing Events ─────────────────────────────────────────────────────────────

export type BillingEventType =
  | "subscription_created"
  | "subscription_upgraded"
  | "subscription_downgraded"
  | "subscription_renewed"
  | "subscription_cancelled"
  | "trial_started"
  | "trial_ended"
  | "payment_succeeded"
  | "payment_failed"
  | "usage_overage";

export interface DbBillingEvent {
  id: string;
  tenant_id: string;
  event_type: BillingEventType;
  details: Record<string, unknown>;
  created_at: string;
}

export type DbBillingEventInsert = Omit<DbBillingEvent, "id" | "created_at">;
