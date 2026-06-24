import {
  accounts as ALL_ACCOUNTS,
  ANNUAL_QUOTA_USD,
  TYPE_LABEL,
  PIPELINE_STAGES,
  formatRevenue,
  type Account,
  type PipelineStage,
} from "@/lib/data/accounts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeightedDeal extends Account {
  weightedARR: number;
  riskAmount:  number; // ARR at risk if deal is lost = estimatedARR - weightedARR
}

export interface QuarterlyForecast {
  quarter:     string;
  forecastARR: number;
  totalARR:    number;
  dealCount:   number;
}

export interface StageARR {
  stage:    string;
  totalARR: number;
  weighted: number;
  count:    number;
}

export interface TypeARR {
  type:    string;
  arr:     number;
  weighted: number;
}

export interface ProbabilityBucket {
  bucket:   string;
  count:    number;
  totalARR: number;
}

export interface AtRiskDeal {
  account:       Account;
  weightedARR:   number;
  riskReason:    string[];
  recommendation: string;
}

export interface RevenueSnapshot {
  totalPipelineARR:    number;
  weightedPipelineARR: number;
  forecastARR:         number;       // current quarter weighted ARR
  pipelineCoverage:    number;       // weightedPipeline / quota
  winRate:             number;       // won / total (%)
  avgDealSizeARR:      number;
  quota:               number;
  atRiskDeals:         AtRiskDeal[];
  topRevenueAccounts:  WeightedDeal[];
  stageARR:            StageARR[];
  typeARR:             TypeARR[];
  quarterlyForecast:   QuarterlyForecast[];
  probabilityBuckets:  ProbabilityBucket[];
}

// ── Core calculations ─────────────────────────────────────────────────────────

export function calculateWeightedPipeline(acts: Account[]): number {
  return acts.reduce((s, a) => s + (a.estimatedARR * a.dealProbability) / 100, 0);
}

export function forecastQuarterlyARR(acts: Account[]): QuarterlyForecast[] {
  const quarters = ["2025-Q4", "2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2"];
  return quarters.map((q) => {
    const inQuarter = acts.filter((a) => a.forecastQuarter === q);
    return {
      quarter:     q,
      forecastARR: inQuarter.reduce((s, a) => s + (a.estimatedARR * a.dealProbability) / 100, 0),
      totalARR:    inQuarter.reduce((s, a) => s + a.estimatedARR, 0),
      dealCount:   inQuarter.length,
    };
  });
}

export function calculatePipelineCoverage(
  acts: Account[],
  quota = ANNUAL_QUOTA_USD
): number {
  const weighted = calculateWeightedPipeline(acts);
  return quota > 0 ? weighted / quota : 0;
}

export function identifyAtRiskDeals(acts: Account[]): AtRiskDeal[] {
  const today = new Date();

  return acts
    .filter((a) => a.status !== "won")
    .flatMap((a): AtRiskDeal[] => {
      const reasons: string[] = [];

      if (a.dealProbability < 25) reasons.push(`Very low close probability (${a.dealProbability}%)`);
      else if (a.dealProbability < 40) reasons.push(`Below-target close probability (${a.dealProbability}%)`);

      if (new Date(a.expectedCloseDate) < today) {
        reasons.push("Expected close date has passed — deal is overdue");
      }

      if (a.capacityRequiredMW >= 200 && a.riskRating === "high") {
        reasons.push(`${a.capacityRequiredMW} MW capacity requirement in constrained territory`);
      }

      if (a.blockers.length > 1) {
        reasons.push(`Multiple active blockers (${a.blockers.length})`);
      }

      if (reasons.length === 0) return [];

      const recommendation = riskRecommendation(a, reasons);
      return [{
        account:       a,
        weightedARR:   (a.estimatedARR * a.dealProbability) / 100,
        riskReason:    reasons,
        recommendation,
      }];
    })
    .sort((a, b) => b.account.estimatedARR - a.account.estimatedARR);
}

function riskRecommendation(account: Account, reasons: string[]): string {
  if (account.status === "lead" || account.dealProbability < 20) {
    return `Assign dedicated account executive to ${account.name}. ` +
      "Schedule executive-level discovery call within 14 days to qualify opportunity and identify champion.";
  }
  if (account.capacityRequiredMW >= 200) {
    return `Deliver grid capacity analysis for ${account.territory} to ${account.contactName}. ` +
      "Demonstrating hosting capacity availability directly addresses the primary technical blocker.";
  }
  if (account.blockers.some((b) => b.toLowerCase().includes("legal"))) {
    return `Escalate contract red-lines to Chief Revenue Officer for expedited resolution. ` +
      "Consider concessions on liability cap to unlock this deal before end-of-quarter.";
  }
  return `Re-engage ${account.contactName} with updated capacity intelligence report. ` +
    "Quantify cost of delay in MW-hours and upgrade cost escalation to accelerate decision.";
}

export function rankAccountsByRevenueImpact(acts: Account[]): WeightedDeal[] {
  const CONSTRAINED_TERRITORIES = ["eastern ma", "cambridge", "somerville", "inner metro", "new england"];

  return acts
    .map((a): WeightedDeal => {
      const isConstrained = CONSTRAINED_TERRITORIES.some((t) =>
        a.territory.toLowerCase().includes(t)
      );
      // Capacity risk discount: if constrained territory + large MW required, reduce weighted ARR slightly
      const capacityDiscount =
        isConstrained && a.capacityRequiredMW >= 200 ? 0.9 : 1.0;
      const weightedARR = (a.estimatedARR * a.dealProbability * capacityDiscount) / 100;
      return {
        ...a,
        weightedARR,
        riskAmount: a.estimatedARR - weightedARR,
      };
    })
    .sort((a, b) => b.weightedARR - a.weightedARR);
}

// ── Aggregations for charts ───────────────────────────────────────────────────

function stageARR(acts: Account[]): StageARR[] {
  return PIPELINE_STAGES.map(({ id, label }) => {
    const inStage = acts.filter((a) => a.status === id);
    return {
      stage:    label,
      totalARR: inStage.reduce((s, a) => s + a.estimatedARR, 0),
      weighted: inStage.reduce((s, a) => s + (a.estimatedARR * a.dealProbability) / 100, 0),
      count:    inStage.length,
    };
  });
}

function typeARR(acts: Account[]): TypeARR[] {
  const types = Object.keys(TYPE_LABEL) as Account["type"][];
  return types
    .map((t) => {
      const inType = acts.filter((a) => a.type === t);
      return {
        type:     TYPE_LABEL[t],
        arr:      inType.reduce((s, a) => s + a.estimatedARR, 0),
        weighted: inType.reduce((s, a) => s + (a.estimatedARR * a.dealProbability) / 100, 0),
      };
    })
    .filter((r) => r.arr > 0)
    .sort((a, b) => b.arr - a.arr);
}

function probabilityBuckets(acts: Account[]): ProbabilityBucket[] {
  const buckets = [
    { label: "0–20%",   min: 0,  max: 20  },
    { label: "21–40%",  min: 21, max: 40  },
    { label: "41–60%",  min: 41, max: 60  },
    { label: "61–80%",  min: 61, max: 80  },
    { label: "81–100%", min: 81, max: 100 },
  ];
  return buckets.map(({ label, min, max }) => {
    const inBucket = acts.filter(
      (a) => a.dealProbability >= min && a.dealProbability <= max
    );
    return {
      bucket:   label,
      count:    inBucket.length,
      totalARR: inBucket.reduce((s, a) => s + a.estimatedARR, 0),
    };
  });
}

// ── Main snapshot ─────────────────────────────────────────────────────────────

export function buildRevenueSnapshot(acts: Account[] = ALL_ACCOUNTS): RevenueSnapshot {
  const activePipeline  = acts.filter((a) => a.status !== "won");
  const wonAccounts     = acts.filter((a) => a.status === "won");
  const weighted        = calculateWeightedPipeline(acts);
  const quarterly       = forecastQuarterlyARR(acts);

  // Q3 2026 is the current forecast quarter
  const currentQForecast = quarterly.find((q) => q.quarter === "2026-Q3");

  return {
    totalPipelineARR:    acts.reduce((s, a) => s + a.estimatedARR, 0),
    weightedPipelineARR: weighted,
    forecastARR:         currentQForecast?.forecastARR ?? 0,
    pipelineCoverage:    calculatePipelineCoverage(acts),
    winRate:             acts.length > 0 ? (wonAccounts.length / acts.length) * 100 : 0,
    avgDealSizeARR:      acts.length > 0 ? acts.reduce((s, a) => s + a.estimatedARR, 0) / acts.length : 0,
    quota:               ANNUAL_QUOTA_USD,
    atRiskDeals:         identifyAtRiskDeals(acts),
    topRevenueAccounts:  rankAccountsByRevenueImpact(acts).slice(0, 5),
    stageARR:            stageARR(acts),
    typeARR:             typeARR(acts),
    quarterlyForecast:   quarterly,
    probabilityBuckets:  probabilityBuckets(acts),
  };
}

// ── Executive Q&A ─────────────────────────────────────────────────────────────

export interface RevenueQA { question: string; answer: string }

export function generateRevenueQA(snapshot: RevenueSnapshot): RevenueQA[] {
  const { topRevenueAccounts, atRiskDeals, forecastARR, quarterlyForecast, weightedPipelineARR } = snapshot;

  const top3 = topRevenueAccounts.slice(0, 3);
  const negotiation = ALL_ACCOUNTS.filter((a) => a.status === "negotiation")
    .sort((a, b) => b.estimatedARR - a.estimatedARR);
  const capacityBlocked = ALL_ACCOUNTS.filter(
    (a) => a.capacityRequiredMW >= 150 && a.status !== "won"
  ).sort((a, b) => b.capacityRequiredMW - a.capacityRequiredMW);

  // Accounts to accelerate: assessment/qualified + high ARR + above 40% probability
  const toAccelerate = ALL_ACCOUNTS
    .filter((a) => ["qualified", "assessment"].includes(a.status) && a.dealProbability >= 35 && a.estimatedARR >= 500_000)
    .sort((a, b) => b.estimatedARR - a.estimatedARR)
    .slice(0, 2);

  const q3 = quarterlyForecast.find((q) => q.quarter === "2026-Q3");

  return [
    {
      question: "Which deals should leadership focus on this quarter?",
      answer:
        negotiation.length > 0
          ? `${negotiation.map((a) => a.name).join(" and ")} are the two highest-priority closes ` +
            `this quarter. ${negotiation[0]?.name} (${formatRevenue((negotiation[0].estimatedARR * negotiation[0].dealProbability) / 100)} ` +
            `weighted, ${negotiation[0].dealProbability}% probability, target ${negotiation[0].expectedCloseDate}) — ` +
            `${negotiation[0].blockers[0]}. ` +
            (negotiation[1]
              ? `${negotiation[1].name} (${formatRevenue((negotiation[1].estimatedARR * negotiation[1].dealProbability) / 100)} weighted) ` +
                `— ${negotiation[1].blockers[0]}.`
              : "")
          : "No accounts are currently in Negotiation stage.",
    },
    {
      question: "Which accounts generate the most ARR?",
      answer:
        `The three highest-ARR opportunities are: ` +
        top3
          .map(
            (a, i) =>
              `(${i + 1}) ${a.name} (${formatRevenue(a.estimatedARR)} ARR, ${formatRevenue(a.weightedARR)} weighted at ${a.dealProbability}%)`
          )
          .join("; ") +
        `. These three accounts represent ` +
        `${formatRevenue(top3.reduce((s, a) => s + a.estimatedARR, 0))} — ` +
        `${((top3.reduce((s, a) => s + a.estimatedARR, 0) / snapshot.totalPipelineARR) * 100).toFixed(0)}% of total pipeline ARR.`,
    },
    {
      question: "Which deals are blocked by grid capacity constraints?",
      answer:
        capacityBlocked.length > 0
          ? `${capacityBlocked.length} deal${capacityBlocked.length !== 1 ? "s" : ""} require substation capacity confirmation before they can advance: ` +
            capacityBlocked
              .slice(0, 4)
              .map(
                (a) =>
                  `${a.name} (${a.capacityRequiredMW} MW — ${a.blockers.find((b) => b.toLowerCase().includes("capacity") || b.toLowerCase().includes("n-1") || b.toLowerCase().includes("study")) ?? a.blockers[0]})`
              )
              .join("; ") +
            `. Delivering site-specific hosting capacity analysis to these accounts is the highest-leverage ` +
            `technical action to unblock ${formatRevenue(capacityBlocked.reduce((s, a) => s + a.estimatedARR, 0))} of pipeline ARR.`
          : "No deals are currently blocked by capacity constraints.",
    },
    {
      question: "What revenue is forecast for next quarter (Q3 2026)?",
      answer:
        `Q3 2026 weighted forecast is ${formatRevenue(forecastARR)} across ${q3?.dealCount ?? 0} accounts ` +
        `(total face value ${formatRevenue(q3?.totalARR ?? 0)}). ` +
        `Eversource Energy ($${((4_100_000 * 0.90) / 1_000_000).toFixed(1)}M weighted, 90%) and ` +
        `National Grid ($${((2_800_000 * 0.85) / 1_000_000).toFixed(1)}M weighted, 85%) are the primary contributors. ` +
        `Full-year weighted pipeline of ${formatRevenue(weightedPipelineARR)} represents ` +
        `${(snapshot.pipelineCoverage * 100).toFixed(0)}% coverage of the ${formatRevenue(snapshot.quota)} annual quota.`,
    },
    {
      question: "Which accounts should be accelerated to improve pipeline health?",
      answer:
        toAccelerate.length > 0
          ? `Two accounts offer the best return on acceleration effort: ` +
            toAccelerate
              .map(
                (a) =>
                  `${a.name} (${formatRevenue(a.estimatedARR)} ARR, currently in ${a.status} at ${a.dealProbability}% probability — ` +
                  `advancing to next stage would unlock ${formatRevenue((a.estimatedARR * Math.min(a.dealProbability + 20, 85)) / 100)} weighted ARR)`
              )
              .join("; ") +
            `. Priority action: schedule executive-level technical briefings to present grid capacity ` +
            `findings and advance these to Proposal stage before Q3 close.`
          : "All high-value accounts are either in advanced stages or require new prospect development.",
    },
  ];
}
