/**
 * Customer acquisition and sales pipeline types
 */

// ── Target Account ────────────────────────────────────────────────────────────

export type AccountType = "utility" | "developer" | "consultant";
export type UtilityCategory = "investor-owned" | "public" | "cooperative" | "municipal";
export type ProspectStage = "cold" | "contacted" | "interested" | "demo_scheduled" | "demo_completed" | "pilot_active" | "pilot_closed" | "customer" | "lost";

export interface DbTargetAccount {
  id: string;
  company_name: string;
  account_type: AccountType;
  website: string;
  service_territory: string;
  annual_capex: number;
  num_substations: number;
  utility_category?: UtilityCategory;
  headquarters: string;
  industry_focus?: string; // For developers: data center, manufacturing, etc.
  linked_in_url?: string;
  crunchbase_url?: string;
  priority_score: number; // 1-100
  notes: string;
  created_at: string;
}

// ── Prospect Record ───────────────────────────────────────────────────────────

export interface DbProspect {
  id: string;
  target_account_id: string;
  stage: ProspectStage;
  contact_name: string;
  contact_title: string;
  contact_email: string;
  contact_phone?: string;
  contact_linkedin?: string;
  engagement_score: number; // 0-100
  last_contact_date?: string;
  next_followup_date?: string;
  demo_scheduled_date?: string;
  pilot_start_date?: string;
  pilot_end_date?: string;
  estimated_arr: number;
  closed_date?: string;
  closed_won: boolean;
  loss_reason?: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ── Outreach Attempt ─────────────────────────────────────────────────────────

export type OutreachChannel = "email" | "linkedin" | "phone" | "referral";
export type OutreachStatus = "queued" | "sent" | "bounced" | "opened" | "clicked" | "replied";

export interface DbOutreachAttempt {
  id: string;
  prospect_id: string;
  channel: OutreachChannel;
  status: OutreachStatus;
  template_id: string;
  message_content: string;
  sent_at: string;
  opened_at?: string;
  clicked_at?: string;
  replied_at?: string;
  response_text?: string;
  created_at: string;
}

// ── Outreach Template ────────────────────────────────────────────────────────

export interface DbOutreachTemplate {
  id: string;
  channel: OutreachChannel;
  stage: ProspectStage;
  name: string;
  subject_line?: string;
  body: string;
  cta: string;
  personalization_fields: string[]; // e.g., ["{{company_name}}", "{{contact_name}}"]
  created_at: string;
}

// ── Meeting Record ───────────────────────────────────────────────────────────

export type MeetingOutcome = "positive" | "neutral" | "objection" | "reschedule" | "no_show";

export interface DbProspectMeeting {
  id: string;
  prospect_id: string;
  meeting_type: "discovery" | "demo" | "technical" | "executive";
  scheduled_at: string;
  completed_at?: string;
  duration_minutes?: number;
  outcome?: MeetingOutcome;
  attendees: string[]; // Names
  notes: string;
  next_steps: string;
  created_at: string;
  updated_at: string;
}

// ── Pilot Result ──────────────────────────────────────────────────────────────

export interface DbPilotResult {
  id: string;
  prospect_id: string;
  pilot_start_date: string;
  pilot_end_date: string;
  success_criteria_met: number; // 0-5
  feedback_score: number; // 1-10
  scenarios_run: number;
  insights_generated: number;
  time_to_roi_visible: string; // e.g., "2 hours", "1 day"
  net_promoter_score?: number;
  testimonial?: string;
  case_study_draft?: string;
  created_at: string;
}

// ── Follow-up Action ─────────────────────────────────────────────────────────

export type ActionType = "email" | "call" | "meeting" | "proposal" | "contract";
export type ActionStatus = "pending" | "completed" | "skipped";

export interface DbFollowupAction {
  id: string;
  prospect_id: string;
  action_type: ActionType;
  description: string;
  due_date: string;
  status: ActionStatus;
  completed_at?: string;
  notes: string;
  assigned_to?: string;
  created_at: string;
}
