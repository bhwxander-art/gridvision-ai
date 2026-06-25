import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Pilot Customer Types ───────────────────────────────────────────────────────

export interface PilotCustomer {
  id: string;
  companyName: string;
  region: string;
  utilityType: "public" | "cooperative" | "municipal" | "investor-owned";
  serviceArea: string; // e.g., "2M+ customers"
  substations: number;
  contactName: string;
  contactEmail: string;
  contactRole: string;
  status: "prospects" | "evaluation" | "pilot" | "decision" | "won" | "lost";
  startDate?: string;
  expectedDecisionDate?: string;
  feedbackScore?: number; // 1-10
  successMetrics?: Record<string, number>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PilotMetrics {
  totalProspects: number;
  inEvaluation: number;
  inPilot: number;
  decisions30Days: number;
  avgFeedbackScore: number;
  conversionRate: number; // pilots to won
  servicingMW: number; // Total MW across all customers
  servicingCustomers: number; // Total customer count
}

// ── Pilot Customer Management ──────────────────────────────────────────────────

export async function createPilotCustomer(
  client: SupabaseClient,
  customer: Omit<PilotCustomer, "id" | "createdAt" | "updatedAt">
): Promise<PilotCustomer> {
  const { data, error } = await client
    .from("pilot_customers")
    .insert({
      company_name: customer.companyName,
      region: customer.region,
      utility_type: customer.utilityType,
      service_area: customer.serviceArea,
      substations: customer.substations,
      contact_name: customer.contactName,
      contact_email: customer.contactEmail,
      contact_role: customer.contactRole,
      status: customer.status,
      start_date: customer.startDate,
      expected_decision_date: customer.expectedDecisionDate,
      feedback_score: customer.feedbackScore,
      success_metrics: customer.successMetrics,
      notes: customer.notes,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create pilot customer: ${error.message}`);
  }

  return toPilotCustomer(data);
}

export async function getPilotCustomers(
  client: SupabaseClient,
  status?: string
): Promise<PilotCustomer[]> {
  let query = client.from("pilot_customers").select("*");

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch pilot customers: ${error.message}`);
  }

  return (data ?? []).map(toPilotCustomer);
}

export async function updatePilotCustomer(
  client: SupabaseClient,
  id: string,
  updates: Partial<PilotCustomer>
): Promise<PilotCustomer> {
  const updateData: Record<string, unknown> = {};

  if (updates.feedbackScore !== undefined) updateData.feedback_score = updates.feedbackScore;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.successMetrics !== undefined) updateData.success_metrics = updates.successMetrics;
  if (updates.expectedDecisionDate !== undefined)
    updateData.expected_decision_date = updates.expectedDecisionDate;

  const { data, error } = await client
    .from("pilot_customers")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update pilot customer: ${error.message}`);
  }

  return toPilotCustomer(data);
}

// ── Pilot Metrics ──────────────────────────────────────────────────────────────

export async function getPilotMetrics(
  client: SupabaseClient
): Promise<PilotMetrics> {
  const { data, error } = await client
    .from("pilot_customers")
    .select("*");

  if (error) {
    throw new Error(`Failed to fetch pilot metrics: ${error.message}`);
  }

  const customers = data ?? [];

  const totalProspects = customers.filter((c) => c.status === "prospects").length;
  const inEvaluation = customers.filter((c) => c.status === "evaluation").length;
  const inPilot = customers.filter((c) => c.status === "pilot").length;
  const won = customers.filter((c) => c.status === "won").length;

  // 30-day decisions
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const decisions30Days = customers.filter((c) => {
    if (!c.start_date) return false;
    const startDate = new Date(c.start_date);
    return startDate > thirtyDaysAgo && (c.status === "won" || c.status === "lost");
  }).length;

  // Average feedback
  const feedbackScores = customers
    .filter((c) => c.feedback_score !== null)
    .map((c) => c.feedback_score);
  const avgFeedbackScore = feedbackScores.length > 0
    ? feedbackScores.reduce((a, b) => a + b) / feedbackScores.length
    : 0;

  // Conversion rate
  const conversionRate = inPilot + won > 0 ? (won / (inPilot + won)) * 100 : 0;

  // Total MW and customers
  const servicingMW = customers.reduce((sum, c) => sum + (c.substations ?? 0) * 50, 0); // Assume 50MW per substation
  const servicingCustomers = customers.reduce((sum, c) => {
    const serviceArea = c.service_area ?? "";
    if (serviceArea.includes("M+")) {
      return sum + 1000000;
    }
    if (serviceArea.includes("K")) {
      const match = serviceArea.match(/(\d+)K/);
      return sum + (match ? parseInt(match[1]) * 1000 : 0);
    }
    return sum;
  }, 0);

  return {
    totalProspects,
    inEvaluation,
    inPilot,
    decisions30Days,
    avgFeedbackScore,
    conversionRate,
    servicingMW,
    servicingCustomers,
  };
}

// ── Helper Functions ───────────────────────────────────────────────────────────

function toPilotCustomer(row: any): PilotCustomer {
  return {
    id: row.id,
    companyName: row.company_name,
    region: row.region,
    utilityType: row.utility_type,
    serviceArea: row.service_area,
    substations: row.substations,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactRole: row.contact_role,
    status: row.status,
    startDate: row.start_date,
    expectedDecisionDate: row.expected_decision_date,
    feedbackScore: row.feedback_score,
    successMetrics: row.success_metrics,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Success Criteria Tracking ──────────────────────────────────────────────────

export interface SuccessCriteria {
  name: string;
  description: string;
  metric: string;
  targetValue: number;
  actualValue: number;
  achieved: boolean;
}

export function evaluateSuccessCriteria(
  customer: PilotCustomer
): SuccessCriteria[] {
  const metrics = customer.successMetrics ?? {};

  return [
    {
      name: "Platform Usability",
      description: "Planning team can use platform without developer support",
      metric: "feedback_score",
      targetValue: 7,
      actualValue: customer.feedbackScore ?? 0,
      achieved: (customer.feedbackScore ?? 0) >= 7,
    },
    {
      name: "Time to First Scenario",
      description: "Create and run first scenario within 2 hours of setup",
      metric: "hours_to_scenario",
      targetValue: 2,
      actualValue: metrics.hoursToScenario ?? 999,
      achieved: (metrics.hoursToScenario ?? 999) <= 2,
    },
    {
      name: "Capacity Planning Insight",
      description: "Scenario reveals actionable capacity planning insights",
      metric: "insights_found",
      targetValue: 1,
      actualValue: metrics.insightsFound ?? 0,
      achieved: (metrics.insightsFound ?? 0) >= 1,
    },
    {
      name: "Cost Savings Visibility",
      description: "ROI calculator shows >$100K annual savings potential",
      metric: "estimated_savings",
      targetValue: 100000,
      actualValue: metrics.estimatedSavings ?? 0,
      achieved: (metrics.estimatedSavings ?? 0) >= 100000,
    },
    {
      name: "Decision Timeline",
      description: "Customer reaches decision within 30 days of pilot start",
      metric: "days_to_decision",
      targetValue: 30,
      actualValue: metrics.daysToDecision ?? 999,
      achieved: (metrics.daysToDecision ?? 999) <= 30,
    },
  ];
}
