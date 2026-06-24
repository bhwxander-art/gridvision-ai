import type {
  Account,
  AccountType,
  AccountPriority,
  PipelineStage,
} from "@/lib/data/accounts";
import { formatRevenue } from "@/lib/data/accounts";

// ── Scoring ───────────────────────────────────────────────────────────────────

export interface OpportunityScore {
  opportunityScore: number;   // 0–100
  priority:         AccountPriority;
  breakdown: {
    growthMW:       number;
    revenue:        number;
    strategic:      number;
    pipeline:       number;
  };
}

const TYPE_WEIGHT: Record<AccountType, number> = {
  hyperscaler:             20,
  utility:                 18,
  investor:                15,
  "data-center-developer": 12,
  "industrial-customer":    5,
};

const STAGE_WEIGHT: Record<PipelineStage, number> = {
  lead:        7,
  qualified:   9,
  assessment:  10,
  proposal:    9,
  negotiation: 8,
  won:         5,
};

export function scoreOpportunity(account: Account): OpportunityScore {
  const growthMW  = Math.min(40, (account.projectedGrowthMW / 500) * 40);
  const revenue   = Math.min(30, (account.estimatedRevenueUSD / 3_000_000) * 30);
  const strategic = TYPE_WEIGHT[account.type] ?? 0;
  const pipeline  = STAGE_WEIGHT[account.status] ?? 0;

  const total = Math.min(100, Math.round(growthMW + revenue + strategic + pipeline));

  let priority: AccountPriority;
  if (total >= 76) priority = "strategic";
  else if (total >= 51) priority = "high";
  else if (total >= 26) priority = "medium";
  else priority = "low";

  return {
    opportunityScore: total,
    priority,
    breakdown: {
      growthMW:  Math.round(growthMW),
      revenue:   Math.round(revenue),
      strategic: Math.round(strategic),
      pipeline:  Math.round(pipeline),
    },
  };
}

// ── Q&A generation ────────────────────────────────────────────────────────────

export interface AccountQA {
  question: string;
  answer:   string;
}

function territoryRisk(territory: string): string {
  const constrained = ["eastern ma", "cambridge", "somerville", "inner metro", "kendall"];
  return constrained.some((k) => territory.toLowerCase().includes(k)) ? "constrained" : "adequate";
}

function upgradeNarrative(mw: number, territory: string): string {
  const risk = territoryRisk(territory);
  if (mw >= 400) {
    return risk === "constrained"
      ? `At ${mw} MW, a new substation site study is the critical path. ` +
        "Existing Cambridge Central and Somerville East assets cannot absorb this demand " +
        "without N-1 violations. A transformer bank addition ($22M) and potential new substation ($45M) " +
        "should be scoped in the interconnection feasibility study."
      : `A ${mw} MW programme requires a full system impact study. Feeder reconductor work ` +
        "($3–12M per circuit) and potential substation expansion ($18–22M) are likely prerequisites " +
        "for a conditional approval from the ISO-NE Interconnection queue.";
  }
  if (mw >= 150) {
    return risk === "constrained"
      ? `${mw} MW in a constrained territory requires transformer loading assessment and possible ` +
        "feeder reconductor ($3–12M). N-1 compliance review at the affected substation is mandatory " +
        "before interconnection approval can proceed."
      : `${mw} MW falls within the range addressable by feeder upgrades and transformer optimisation ` +
        "($5–15M). A system impact study should confirm hosting capacity and identify any network " +
        "upgrade contributions required under ISO-NE Schedule 23.";
  }
  return mw > 0
    ? `${mw} MW of incremental load is manageable within existing substation capacity in ` +
      `${territory}, subject to hosting capacity confirmation and load flow analysis.`
    : "No incremental grid upgrades are anticipated at current load levels.";
}

function nextStepByStage(stage: PipelineStage, name: string): string {
  const steps: Record<PipelineStage, string> = {
    lead:
      `Qualify ${name} by scheduling a grid capacity briefing with the technical team. ` +
      "Confirm territory, MW profile, and target COD before advancing to a formal assessment. " +
      "Assign an account executive and log initial contact in CRM.",
    qualified:
      `Commission a preliminary capacity analysis for ${name}'s proposed sites. ` +
      "Prepare a capacity availability summary with risk-rated substation options. " +
      "Schedule a technical review meeting to present findings and discuss upgrade options.",
    assessment:
      `Deliver the technical assessment report to ${name}. ` +
      "Include per-substation headroom, N-1 compliance status, and a prioritised upgrade cost schedule. " +
      "Obtain feedback on preferred sites and confirm MW profile before moving to proposal.",
    proposal:
      `Finalise the commercial proposal for ${name}, incorporating the technical assessment. ` +
      "Include capacity reservation SLA, upgrade timeline, and pricing. " +
      "Target proposal submission within 10 business days.",
    negotiation:
      `Close the MSA with ${name}. Address outstanding red-lines on liability cap and SLA remedies. ` +
      "Align legal, finance, and delivery teams on contract execution timeline. " +
      "Target signed agreement within 30 days.",
    won:
      `Manage active delivery for ${name}. ` +
      "Ensure quarterly capacity data refreshes are on schedule. " +
      "Identify upsell opportunities in adjacent territories or expanded MW scope.",
  };
  return steps[stage] ?? "Advance to next pipeline stage.";
}

export function generateAccountQA(
  account: Account,
  score: OpportunityScore
): AccountQA[] {
  const rev = formatRevenue(account.estimatedRevenueUSD);
  const mw  = account.projectedGrowthMW;

  const typeNarrative: Record<AccountType, string> = {
    hyperscaler:
      `${account.name} is a tier-1 hyperscaler — one of the largest drivers of AI-driven grid demand ` +
      `growth globally. At ${mw} MW of projected growth in ${account.territory}, this account has direct ` +
      "implications for transmission planning, substation hosting capacity, and capital programme " +
      "prioritisation across the service territory. Hyperscalers operate at near-unity power factor " +
      "and high load factors, making them the most revenue-predictable load class in the queue.",
    utility:
      `${account.name} is a transmission-level partner whose interconnection agreements and capital ` +
      "programmes directly affect Eastern MA distribution planning. Deepening this relationship enables " +
      "co-investment in grid hardening projects, accelerates regulatory approvals, and creates a " +
      "repeatable revenue stream tied to DPU filing cycles and IRP updates.",
    "data-center-developer":
      `${account.name} represents concentrated, highly predictable load operating at near-unity power ` +
      `factor — ideal for utility revenue stability. Their ${mw} MW growth pipeline requires substation ` +
      "hosting capacity analysis across multiple sites, creating a recurring advisory revenue model " +
      "as each campus progresses through the ISO-NE interconnection queue.",
    investor:
      `${account.name} is allocating significant capital into grid-adjacent infrastructure assets. ` +
      `Their ${mw} MW portfolio pipeline requires capacity risk scoring, substation constraint mapping, ` +
      "and upgrade cost estimation — exactly the outputs GridVision produces. This creates a " +
      "high-value advisory revenue stream tied to deal underwriting rather than individual MW.",
    "industrial-customer":
      `${account.name} is an anchor industrial load with stable, well-understood consumption patterns. ` +
      `Their ${mw} MW expansion is tied to reshoring and capital investment programmes, providing ` +
      "predictable load growth with low interconnection complexity. Maintaining this relationship " +
      "supports territory load forecasting accuracy and creates case-study value.",
  };

  return [
    {
      question: "Why is this account important?",
      answer:   typeNarrative[account.type],
    },
    {
      question: "What revenue opportunity exists?",
      answer:
        `${account.name} represents an estimated ${rev} in annual platform revenue at current engagement scope. ` +
        `With ${mw} MW of projected growth across ${account.territory}, the long-term revenue potential ` +
        `could expand as additional sites enter the interconnection queue. ` +
        `The account carries an opportunity score of ${score.opportunityScore}/100 — rated ` +
        `${score.priority.toUpperCase()} priority. ` +
        (account.activeProjects.length > 0
          ? `Active projects (${account.activeProjects.join(", ")}) create near-term engagement depth.`
          : "No active projects yet — qualified opportunity pending technical engagement."),
    },
    {
      question: "What grid upgrades may be required?",
      answer:   upgradeNarrative(mw, account.territory),
    },
    {
      question: "What risks exist?",
      answer:
        account.riskRating === "high"
          ? `${account.name} carries a HIGH commercial risk rating. Grid constraints in ${account.territory} ` +
            "may delay or limit interconnection approval, creating schedule risk for their capital programme. " +
            "Regulatory uncertainty around DPU cost allocation and ISO-NE queue reform could affect project viability. " +
            "Ensure the proposal includes upgrade cost estimates and a contingency timeline."
          : account.riskRating === "medium"
          ? `${account.name} carries a MEDIUM risk rating. Technical risks include substation headroom ` +
            `constraints in ${account.territory} and potential N-1 compliance gaps that require capital investment. ` +
            "Commercial risk is manageable with a structured proposal that identifies upgrade costs upfront."
          : `${account.name} carries a LOW risk rating. Load profile is well-understood, grid capacity ` +
            `in ${account.territory} is adequate, and the account has established regulatory relationships. ` +
            "Primary risk is competitive displacement if a rival advisory firm engages first.",
    },
    {
      question: "What should the sales team do next?",
      answer:   nextStepByStage(account.status, account.name),
    },
  ];
}
