/**
 * CRM and customer management data types
 */

// ── Customer Records ───────────────────────────────────────────────────────────

export type CustomerStatus = "prospect" | "evaluating" | "pilot" | "customer" | "churned";
export type UtilitySize = "small" | "medium" | "large" | "enterprise";

export interface DbCustomer {
  id: string;
  tenant_id?: string; // For internal tracking
  company_name: string;
  industry: "utility" | "developer" | "consulting" | "other";
  utility_type?: "public" | "cooperative" | "municipal" | "investor-owned";
  service_area: string;
  substations: number;
  annual_capex: number;
  status: CustomerStatus;
  engagement_score: number; // 0-100
  last_engagement: string;
  pilot_start_date?: string;
  expected_decision_date?: string;
  deal_value_usd?: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export interface DbContact {
  id: string;
  customer_id: string;
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  phone?: string;
  department: "planning" | "operations" | "finance" | "executive" | "it";
  is_primary: boolean;
  engagement_level: "low" | "medium" | "high" | "champion";
  last_contacted: string;
  created_at: string;
  updated_at: string;
}

// ── Meetings ──────────────────────────────────────────────────────────────────

export type MeetingType = "discovery" | "demo" | "technical" | "executive" | "negotiation" | "kickoff";
export type MeetingOutcome = "positive" | "neutral" | "concerns" | "rescheduled" | "cancelled";

export interface DbMeeting {
  id: string;
  customer_id: string;
  contact_ids: string[]; // Array of attendee IDs
  type: MeetingType;
  title: string;
  scheduled_at: string;
  duration_minutes: number;
  outcome?: MeetingOutcome;
  next_steps: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ── Opportunities ─────────────────────────────────────────────────────────────

export type OpportunityStagе = "lead" | "qualified" | "proposal" | "negotiation" | "won" | "lost";

export interface DbOpportunity {
  id: string;
  customer_id: string;
  title: string;
  description: string;
  amount_usd: number;
  stage: OpportunityStagе;
  probability: number; // 0-100
  expected_close_date: string;
  competitor_intel?: string;
  deal_risks: string[];
  created_at: string;
  updated_at: string;
}

// ── Follow-ups ────────────────────────────────────────────────────────────────

export type FollowUpStatus = "pending" | "completed" | "cancelled" | "overdue";
export type FollowUpType = "call" | "email" | "meeting" | "proposal" | "contract" | "other";

export interface DbFollowUp {
  id: string;
  customer_id: string;
  contact_id?: string;
  opportunity_id?: string;
  type: FollowUpType;
  description: string;
  due_date: string;
  status: FollowUpStatus;
  completed_at?: string;
  notes: string;
  assigned_to?: string; // User ID
  created_at: string;
  updated_at: string;
}

// ── Activity Feed ─────────────────────────────────────────────────────────────

export type ActivityType = "meeting" | "email" | "call" | "note" | "task" | "stage_change" | "demo" | "proposal";

export interface DbActivity {
  id: string;
  customer_id: string;
  contact_id?: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: string;
  created_by?: string; // User ID
}
