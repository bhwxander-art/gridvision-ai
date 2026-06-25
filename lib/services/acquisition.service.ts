import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DbTargetAccount,
  DbProspect,
  DbOutreachTemplate,
  ProspectStage,
  OutreachChannel,
} from "@/lib/db/types-acquisition";

// ── Target Accounts ───────────────────────────────────────────────────────────

export async function createTargetAccount(
  client: SupabaseClient,
  account: Omit<DbTargetAccount, "id" | "created_at">
): Promise<DbTargetAccount> {
  const { data, error } = await client
    .from("target_accounts")
    .insert(account)
    .select()
    .single();

  if (error) throw new Error(`Failed to create target account: ${error.message}`);
  return data as DbTargetAccount;
}

export async function listTargetAccounts(
  client: SupabaseClient,
  type?: "utility" | "developer" | "consultant"
): Promise<DbTargetAccount[]> {
  let query = client.from("target_accounts").select("*");

  if (type) query = query.eq("account_type", type);

  const { data, error } = await query.order("priority_score", { ascending: false });

  if (error) throw new Error(`Failed to fetch target accounts: ${error.message}`);
  return (data as DbTargetAccount[]) || [];
}

// ── Prospects ──────────────────────────────────────────────────────────────────

export async function createProspect(
  client: SupabaseClient,
  prospect: Omit<DbProspect, "id" | "created_at" | "updated_at">
): Promise<DbProspect> {
  const { data, error } = await client
    .from("prospects")
    .insert(prospect)
    .select()
    .single();

  if (error) throw new Error(`Failed to create prospect: ${error.message}`);
  return data as DbProspect;
}

export async function getProspectsByStage(
  client: SupabaseClient,
  stage: ProspectStage
): Promise<DbProspect[]> {
  const { data, error } = await client
    .from("prospects")
    .select("*")
    .eq("stage", stage)
    .order("engagement_score", { ascending: false });

  if (error) throw new Error(`Failed to fetch prospects: ${error.message}`);
  return (data as DbProspect[]) || [];
}

export async function updateProspectStage(
  client: SupabaseClient,
  prospectId: string,
  stage: ProspectStage
): Promise<DbProspect> {
  const { data, error } = await client
    .from("prospects")
    .update({ stage })
    .eq("id", prospectId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update prospect: ${error.message}`);
  return data as DbProspect;
}

// ── Outreach Templates ────────────────────────────────────────────────────────

export const DEFAULT_OUTREACH_TEMPLATES: DbOutreachTemplate[] = [
  {
    id: "email-cold-utility",
    channel: "email",
    stage: "cold",
    name: "Cold Email - Utility Exec",
    subject_line: "Accelerate your capacity planning - {{company_name}}",
    body: `Hi {{contact_name}},

I noticed {{company_name}} is managing {{substations}} substations across {{territory}}. Capacity planning at your scale is typically a months-long process.

We built GridVision to help utilities model scenarios in hours instead of weeks. A typical utility saves:
- $20M+/year in capital optimization
- 40% reduction in planning time
- Better interconnection decisions

Would you be open to a 30-minute demo? I can show you how this works on your portfolio.

Best,
[Your Name]`,
    cta: "Schedule Demo",
    personalization_fields: ["company_name", "contact_name", "substations", "territory"],
    created_at: new Date().toISOString(),
  },
  {
    id: "email-cold-developer",
    channel: "email",
    stage: "cold",
    name: "Cold Email - Developer",
    subject_line: "Faster interconnection decisions - {{company_name}}",
    body: `Hi {{contact_name}},

{{company_name}} is pursuing a {{megawatt}} MW data center. Grid interconnection typically takes 90+ days of back-and-forth with utilities.

GridVision helps utilities assess interconnection requests in days, not months. This means:
- Faster feasibility analysis
- Clearer upgrade requirements
- Accelerated permitting

Utility partners using GridVision close interconnections 60% faster. Would you be interested in a brief conversation?

Best,
[Your Name]`,
    cta: "Discuss",
    personalization_fields: ["company_name", "contact_name", "megawatt"],
    created_at: new Date().toISOString(),
  },
  {
    id: "email-followup-1",
    channel: "email",
    stage: "contacted",
    name: "Follow-up 1 (3 days)",
    subject_line: "Re: Accelerate your capacity planning",
    body: `Hi {{contact_name}},

Just following up on my previous email about GridVision. I know you're busy, but I thought this might be worth 20 minutes of your time.

Many utilities in {{territory}} are already seeing benefits. Would you be open to a quick demo?

Best,
[Your Name]`,
    cta: "Book Time",
    personalization_fields: ["contact_name", "territory"],
    created_at: new Date().toISOString(),
  },
  {
    id: "linkedin-connection",
    channel: "linkedin",
    stage: "cold",
    name: "LinkedIn Connection Request",
    body: `Hi {{contact_name}},

I've been following {{company_name}}'s work in capacity planning and grid modernization. I think there could be a great fit here—let's connect!`,
    cta: "Connect",
    personalization_fields: ["contact_name", "company_name"],
    created_at: new Date().toISOString(),
  },
  {
    id: "linkedin-message",
    channel: "linkedin",
    stage: "contacted",
    name: "LinkedIn Direct Message",
    body: `Hi {{contact_name}},

Quick question: is {{company_name}} looking at ways to accelerate capacity planning or interconnection decisions?

We're seeing 40% time reductions with our platform. Happy to share details if relevant.`,
    cta: "Reply",
    personalization_fields: ["contact_name", "company_name"],
    created_at: new Date().toISOString(),
  },
];

export async function getOutreachTemplates(
  client: SupabaseClient,
  channel?: OutreachChannel,
  stage?: ProspectStage
): Promise<DbOutreachTemplate[]> {
  let query = client.from("outreach_templates").select("*");

  if (channel) query = query.eq("channel", channel);
  if (stage) query = query.eq("stage", stage);

  const { data, error } = await query;

  if (error) throw new Error(`Failed to fetch templates: ${error.message}`);
  return (data as DbOutreachTemplate[]) || DEFAULT_OUTREACH_TEMPLATES.filter(
    (t) => (!channel || t.channel === channel) && (!stage || t.stage === stage)
  );
}

// ── Template Personalization ───────────────────────────────────────────────────

export function personalizeTemplate(
  template: DbOutreachTemplate,
  prospect: DbProspect & { account?: DbTargetAccount | null }
): string {
  let result = template.body;

  const account = prospect.account || null;
  const variables: Record<string, string> = {
    contact_name: prospect.contact_name || "there",
    company_name: account?.company_name || "your company",
    substations: String(account?.num_substations || 50),
    territory: account?.service_territory || "your region",
    megawatt: "200", // Default, should be passed
  };

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder, "g"), value);
  }

  return result;
}

// ── Acquisition Metrics ────────────────────────────────────────────────────────

export interface AcquisitionMetrics {
  totalProspects: number;
  byStage: Record<ProspectStage, number>;
  demoCompleted: number;
  pilotActive: number;
  customerCount: number;
  conversionRate: number; // cold → customer %
  arrPipeline: number;
  avgTimeToDemo: number; // days
  avgTimeToClosedWon: number; // days
}

export async function getAcquisitionMetrics(
  client: SupabaseClient
): Promise<AcquisitionMetrics> {
  const { data: prospects, error } = await client
    .from("prospects")
    .select("*");

  if (error) throw new Error(`Failed to fetch acquisition metrics: ${error.message}`);

  const prospectList = (prospects as DbProspect[]) || [];
  const totalProspects = prospectList.length;

  const byStage: Record<ProspectStage, number> = {
    cold: 0,
    contacted: 0,
    interested: 0,
    demo_scheduled: 0,
    demo_completed: 0,
    pilot_active: 0,
    pilot_closed: 0,
    customer: 0,
    lost: 0,
  };

  let demoCompleted = 0;
  let pilotActive = 0;
  let customerCount = 0;
  let arrPipeline = 0;
  const timeToDemo: number[] = [];
  const timeToClosedWon: number[] = [];

  const now = Date.now();

  for (const prospect of prospectList) {
    byStage[prospect.stage]++;

    if (prospect.stage === "demo_completed") demoCompleted++;
    if (prospect.stage === "pilot_active") pilotActive++;
    if (prospect.stage === "customer") {
      customerCount++;
      arrPipeline += prospect.estimated_arr;
    }

    // Time to demo
    if (
      prospect.demo_scheduled_date &&
      ["demo_scheduled", "demo_completed", "pilot_active", "pilot_closed", "customer"].includes(
        prospect.stage
      )
    ) {
      const daysToDemo = Math.floor(
        (new Date(prospect.demo_scheduled_date).getTime() - new Date(prospect.created_at).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      if (daysToDemo >= 0) timeToDemo.push(daysToDemo);
    }

    // Time to closed won
    if (prospect.stage === "customer" && prospect.closed_date) {
      const daysToClosedWon = Math.floor(
        (new Date(prospect.closed_date).getTime() - new Date(prospect.created_at).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      if (daysToClosedWon >= 0) timeToClosedWon.push(daysToClosedWon);
    }
  }

  const conversionRate =
    totalProspects > 0 ? (customerCount / totalProspects) * 100 : 0;
  const avgTimeToDemo = timeToDemo.length > 0 ? timeToDemo.reduce((a, b) => a + b) / timeToDemo.length : 0;
  const avgTimeToClosedWon =
    timeToClosedWon.length > 0
      ? timeToClosedWon.reduce((a, b) => a + b) / timeToClosedWon.length
      : 0;

  return {
    totalProspects,
    byStage,
    demoCompleted,
    pilotActive,
    customerCount,
    conversionRate,
    arrPipeline,
    avgTimeToDemo: Math.round(avgTimeToDemo),
    avgTimeToClosedWon: Math.round(avgTimeToClosedWon),
  };
}
