// ── Types ─────────────────────────────────────────────────────────────────────

export type AccountType =
  | "utility"
  | "data-center-developer"
  | "hyperscaler"
  | "industrial-customer"
  | "investor";

export type PipelineStage =
  | "lead"
  | "qualified"
  | "assessment"
  | "proposal"
  | "negotiation"
  | "won";

export type AccountPriority = "low" | "medium" | "high" | "strategic";
export type AccountRisk     = "low" | "medium" | "high";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  status: PipelineStage;
  /** Current contracted or measured annual peak load */
  annualLoadMW: number;
  /** Incremental MW being requested or forecasted over 3 years */
  projectedGrowthMW: number;
  territory: string;
  /** Full opportunity value in USD (unweighted) */
  estimatedRevenueUSD: number;
  /** Annual Recurring Revenue — committed or contracted value */
  estimatedARR: number;
  /** Close probability 0–100 (used for weighted pipeline) */
  dealProbability: number;
  /** Expected contract execution date (ISO-8601 date) */
  expectedCloseDate: string;
  /** Fiscal quarter this deal is forecasted to close ("2026-Q3") */
  forecastQuarter: string;
  /** Competing vendors or advisory firms in this opportunity */
  competitors: string[];
  /** Blockers preventing advancement to next stage */
  blockers: string[];
  /** MW of substation/feeder capacity that must be confirmed to close */
  capacityRequiredMW: number;
  priority: AccountPriority;
  riskRating: AccountRisk;
  contactName: string;
  contactTitle: string;
  activeProjects: string[];
  notes: string;
}

// ── Annual quota for coverage calculations ────────────────────────────────────

export const ANNUAL_QUOTA_USD = 15_000_000;

// ── Seed accounts ─────────────────────────────────────────────────────────────

export const accounts: Account[] = [

  // ── LEAD ────────────────────────────────────────────────────────────────────

  {
    id:                   "acc-dominion",
    name:                 "Dominion Energy",
    type:                 "utility",
    status:               "lead",
    annualLoadMW:         31_000,
    projectedGrowthMW:    2_400,
    territory:            "Mid-Atlantic / Southeast US",
    estimatedRevenueUSD:  1_200_000,
    estimatedARR:         1_200_000,
    dealProbability:      12,
    expectedCloseDate:    "2027-06-30",
    forecastQuarter:      "2027-Q2",
    competitors:          ["GE Vernova", "S&P Global Commodity Insights", "ABB"],
    blockers:             ["No assigned executive sponsor", "Multi-state procurement process required"],
    capacityRequiredMW:   0,
    priority:             "high",
    riskRating:           "low",
    contactName:          "Jennifer Cahill",
    contactTitle:         "VP, Grid Strategy & Planning",
    activeProjects:       [],
    notes:
      "Referred through ISO-NE working group. Exploring capacity intelligence API for " +
      "multi-state transmission planning. 2,400 MW growth tied to offshore wind interconnection.",
  },
  {
    id:                   "acc-qts",
    name:                 "QTS Data Centers",
    type:                 "data-center-developer",
    status:               "lead",
    annualLoadMW:         0,
    projectedGrowthMW:    120,
    territory:            "Mid-Atlantic / New England",
    estimatedRevenueUSD:  620_000,
    estimatedARR:         620_000,
    dealProbability:      15,
    expectedCloseDate:    "2027-03-31",
    forecastQuarter:      "2027-Q1",
    competitors:          ["Quanta Technology", "Black & Veatch"],
    blockers:             ["Site selection not finalized", "ISO-NE hosting capacity study pending"],
    capacityRequiredMW:   120,
    priority:             "medium",
    riskRating:           "medium",
    contactName:          "Marcus Webb",
    contactTitle:         "Director, Power Strategy",
    activeProjects:       [],
    notes:
      "Evaluating 120 MW expansion across 3 sites. Hosting capacity study required " +
      "at proposed Framingham location before site selection proceeds.",
  },
  {
    id:                   "acc-brookfield",
    name:                 "Brookfield Infrastructure",
    type:                 "investor",
    status:               "lead",
    annualLoadMW:         0,
    projectedGrowthMW:    600,
    territory:            "Northeast United States",
    estimatedRevenueUSD:  720_000,
    estimatedARR:         720_000,
    dealProbability:      18,
    expectedCloseDate:    "2027-06-30",
    forecastQuarter:      "2027-Q2",
    competitors:          ["BCG Infrastructure", "McKinsey & Company"],
    blockers:             ["Investment thesis not finalized", "Board approval required Q3 2026"],
    capacityRequiredMW:   0,
    priority:             "high",
    riskRating:           "low",
    contactName:          "Priya Anand",
    contactTitle:         "Managing Director, Infrastructure",
    activeProjects:       [],
    notes:
      "Deploying capital into grid-adjacent real estate and transmission assets. " +
      "GridVision capacity data directly informs deal underwriting for 600 MW pipeline.",
  },

  // ── QUALIFIED ────────────────────────────────────────────────────────────────

  {
    id:                   "acc-digital-realty",
    name:                 "Digital Realty",
    type:                 "data-center-developer",
    status:               "qualified",
    annualLoadMW:         450,
    projectedGrowthMW:    250,
    territory:            "New England",
    estimatedRevenueUSD:  1_100_000,
    estimatedARR:         1_100_000,
    dealProbability:      30,
    expectedCloseDate:    "2026-12-31",
    forecastQuarter:      "2026-Q4",
    competitors:          ["ESRI", "Quanta Technology"],
    blockers:             ["Legal review of data sharing agreement", "Q3 budget cycle pending"],
    capacityRequiredMW:   250,
    priority:             "high",
    riskRating:           "medium",
    contactName:          "Sarah Kim",
    contactTitle:         "VP, Power & Infrastructure",
    activeProjects:       ["Boston Campus Expansion — Phase II"],
    notes:
      "250 MW growth pipeline across 4 Boston-area campuses. Phase II of the Boston " +
      "campus requires Somerville East and Cambridge Central substation headroom confirmation.",
  },
  {
    id:                   "acc-google",
    name:                 "Google Cloud",
    type:                 "hyperscaler",
    status:               "qualified",
    annualLoadMW:         2_100,
    projectedGrowthMW:    320,
    territory:            "New England",
    estimatedRevenueUSD:  2_100_000,
    estimatedARR:         2_100_000,
    dealProbability:      35,
    expectedCloseDate:    "2027-01-31",
    forecastQuarter:      "2027-Q1",
    competitors:          ["Palantir", "GE Vernova"],
    blockers:             ["Cambridge feasibility study pending", "Executive sponsor procurement review"],
    capacityRequiredMW:   320,
    priority:             "strategic",
    riskRating:           "low",
    contactName:          "Thomas Reilly",
    contactTitle:         "Head of Energy & Sustainability, Americas",
    activeProjects:       ["Cambridge AI Campus — Feasibility"],
    notes:
      "Evaluating headroom for a 320 MW AI campus in the Cambridge / " +
      "Kendall Square corridor. Load factor 0.97. Target COD 2028-Q1.",
  },
  {
    id:                   "acc-blackstone",
    name:                 "Blackstone Infrastructure",
    type:                 "investor",
    status:               "qualified",
    annualLoadMW:         0,
    projectedGrowthMW:    800,
    territory:            "Northeast United States",
    estimatedRevenueUSD:  850_000,
    estimatedARR:         850_000,
    dealProbability:      28,
    expectedCloseDate:    "2027-01-31",
    forecastQuarter:      "2027-Q1",
    competitors:          ["BCG Infrastructure", "McKinsey & Company"],
    blockers:             ["Senior partner alignment required", "Term sheet approval pending"],
    capacityRequiredMW:   0,
    priority:             "strategic",
    riskRating:           "low",
    contactName:          "James Park",
    contactTitle:         "Senior Managing Director, Infrastructure",
    activeProjects:       [],
    notes:
      "Allocating $2.5B into Northeast grid infrastructure assets. GridVision capacity " +
      "risk scores directly support deal screening and portfolio stress-testing.",
  },

  // ── ASSESSMENT ──────────────────────────────────────────────────────────────

  {
    id:                   "acc-equinix",
    name:                 "Equinix",
    type:                 "data-center-developer",
    status:               "assessment",
    annualLoadMW:         680,
    projectedGrowthMW:    180,
    territory:            "Eastern Massachusetts",
    estimatedRevenueUSD:  890_000,
    estimatedARR:         890_000,
    dealProbability:      50,
    expectedCloseDate:    "2026-12-31",
    forecastQuarter:      "2026-Q4",
    competitors:          ["Black & Veatch", "ESRI"],
    blockers:             ["ISO-NE system impact study in progress", "Waltham West N-1 compliance review required"],
    capacityRequiredMW:   180,
    priority:             "high",
    riskRating:           "medium",
    contactName:          "Daniel Torres",
    contactTitle:         "Director, Site Acquisition & Power",
    activeProjects:       ["BO5 Campus — Waltham West Corridor"],
    notes:
      "180 MW BO5 campus on Route 128 corridor. System impact study filed with ISO-NE. " +
      "Waltham West substation N-1 compliance gap is the critical path item.",
  },
  {
    id:                   "acc-microsoft",
    name:                 "Microsoft Azure",
    type:                 "hyperscaler",
    status:               "assessment",
    annualLoadMW:         3_800,
    projectedGrowthMW:    450,
    territory:            "Eastern MA / New York",
    estimatedRevenueUSD:  2_900_000,
    estimatedARR:         2_900_000,
    dealProbability:      55,
    expectedCloseDate:    "2026-12-31",
    forecastQuarter:      "2026-Q4",
    competitors:          ["GE Vernova", "Palantir", "Siemens"],
    blockers:             ["Cambridge Central transformer bank capacity confirmation required"],
    capacityRequiredMW:   450,
    priority:             "strategic",
    riskRating:           "medium",
    contactName:          "Rachel Simmons",
    contactTitle:         "VP, Global Energy & Sustainability",
    activeProjects:       ["Azure Northeast Expansion", "Kendall Hub Phase II"],
    notes:
      "450 MW total pipeline. Kendall Hub Phase II (45 MW) in IA-Executed status. " +
      "Northeast Expansion (405 MW) requires new substation or Cambridge Central third bank.",
  },

  // ── PROPOSAL ────────────────────────────────────────────────────────────────

  {
    id:                   "acc-aws",
    name:                 "Amazon Web Services",
    type:                 "hyperscaler",
    status:               "proposal",
    annualLoadMW:         4_200,
    projectedGrowthMW:    500,
    territory:            "Eastern MA / New England",
    estimatedRevenueUSD:  3_200_000,
    estimatedARR:         3_200_000,
    dealProbability:      65,
    expectedCloseDate:    "2026-09-30",
    forecastQuarter:      "2026-Q3",
    competitors:          ["GE Vernova", "Siemens"],
    blockers:             ["Upgrade cost allocation for Project Helix under negotiation"],
    capacityRequiredMW:   500,
    priority:             "strategic",
    riskRating:           "high",
    contactName:          "Lisa Nguyen",
    contactTitle:         "Director, Grid Interconnection & Policy",
    activeProjects:       ["Project Helix — AI Training Campus", "North Shore Enterprise DC"],
    notes:
      "500 MW across 3 sites. Project Helix (180 MW) at Waltham West exceeds feeder " +
      "hosting capacity by 125 MW — reconductor required. Proposal includes upgrade timeline.",
  },
  {
    id:                   "acc-ge",
    name:                 "General Electric",
    type:                 "industrial-customer",
    status:               "proposal",
    annualLoadMW:         85,
    projectedGrowthMW:    40,
    territory:            "Massachusetts",
    estimatedRevenueUSD:  180_000,
    estimatedARR:         180_000,
    dealProbability:      60,
    expectedCloseDate:    "2026-09-30",
    forecastQuarter:      "2026-Q3",
    competitors:          ["Black & Veatch"],
    blockers:             ["Internal procurement review cycle"],
    capacityRequiredMW:   40,
    priority:             "medium",
    riskRating:           "low",
    contactName:          "Frank Calloway",
    contactTitle:         "VP, Facilities & Operational Energy",
    activeProjects:       ["Lynn Manufacturing Upgrade"],
    notes:
      "40 MW expansion tied to reshoring of advanced manufacturing. " +
      "Served from Boston North substation with adequate headroom.",
  },

  // ── NEGOTIATION ─────────────────────────────────────────────────────────────

  {
    id:                   "acc-national-grid",
    name:                 "National Grid",
    type:                 "utility",
    status:               "negotiation",
    annualLoadMW:         8_200,
    projectedGrowthMW:    1_100,
    territory:            "New England / New York",
    estimatedRevenueUSD:  2_800_000,
    estimatedARR:         2_800_000,
    dealProbability:      85,
    expectedCloseDate:    "2026-08-31",
    forecastQuarter:      "2026-Q3",
    competitors:          ["ABB", "GE Vernova"],
    blockers:             ["MSA red-lines: liability cap — legal review 2026-07-07"],
    capacityRequiredMW:   0,
    priority:             "strategic",
    riskRating:           "low",
    contactName:          "Robert Ashe",
    contactTitle:         "SVP, Distribution Planning & Innovation",
    activeProjects:       ["CapEx Optimisation Programme", "EV Load Integration Study"],
    notes:
      "Joint planning agreement under negotiation for 3-year term. " +
      "MSA red-lines returned — legal review week of 2026-07-07.",
  },
  {
    id:                   "acc-eversource",
    name:                 "Eversource Energy",
    type:                 "utility",
    status:               "negotiation",
    annualLoadMW:         12_400,
    projectedGrowthMW:    1_800,
    territory:            "New England",
    estimatedRevenueUSD:  4_100_000,
    estimatedARR:         4_100_000,
    dealProbability:      90,
    expectedCloseDate:    "2026-07-31",
    forecastQuarter:      "2026-Q3",
    competitors:          [],
    blockers:             ["Final contract execution — MSA target 2026-07-15"],
    capacityRequiredMW:   0,
    priority:             "strategic",
    riskRating:           "low",
    contactName:          "Amanda Pierce",
    contactTitle:         "Director, Grid Modernization",
    activeProjects:       ["Eastern MA Capacity Intelligence Study", "Distribution Automation"],
    notes:
      "Primary territory partner. Full platform licence including real-time ISO-NE " +
      "load data, GIS capacity layer, and capital planning engine. MSA final stage.",
  },

  // ── WON ─────────────────────────────────────────────────────────────────────

  {
    id:                   "acc-bmc",
    name:                 "Boston Medical Center",
    type:                 "industrial-customer",
    status:               "won",
    annualLoadMW:         22,
    projectedGrowthMW:    8,
    territory:            "Inner Metro",
    estimatedRevenueUSD:  55_000,
    estimatedARR:         55_000,
    dealProbability:      100,
    expectedCloseDate:    "2025-12-15",
    forecastQuarter:      "2025-Q4",
    competitors:          [],
    blockers:             [],
    capacityRequiredMW:   8,
    priority:             "low",
    riskRating:           "low",
    contactName:          "Michael O'Brien",
    contactTitle:         "Director, Facilities & Utilities",
    activeProjects:       ["Campus Resilience & Backup Upgrade"],
    notes:
      "Active engagement since 2025-Q3. Annual capacity report delivered. " +
      "Expansion study for new surgical wing scheduled Q4.",
  },
];

// ── Stage metadata ────────────────────────────────────────────────────────────

export const PIPELINE_STAGES: Array<{
  id: PipelineStage;
  label: string;
  color: string;
  textColor: string;
  dotColor: string;
}> = [
  { id: "lead",        label: "Lead",        color: "border-slate-500/30  bg-slate-500/10",   textColor: "text-slate-300",   dotColor: "bg-slate-400"   },
  { id: "qualified",   label: "Qualified",   color: "border-blue-500/30   bg-blue-500/10",    textColor: "text-blue-300",    dotColor: "bg-blue-400"    },
  { id: "assessment",  label: "Assessment",  color: "border-yellow-500/30 bg-yellow-500/10",  textColor: "text-yellow-300",  dotColor: "bg-yellow-400"  },
  { id: "proposal",    label: "Proposal",    color: "border-orange-500/30 bg-orange-500/10",  textColor: "text-orange-300",  dotColor: "bg-orange-400"  },
  { id: "negotiation", label: "Negotiation", color: "border-purple-500/30 bg-purple-500/10",  textColor: "text-purple-300",  dotColor: "bg-purple-400"  },
  { id: "won",         label: "Won",         color: "border-emerald-500/30 bg-emerald-500/10",textColor: "text-emerald-300", dotColor: "bg-emerald-400" },
];

// ── Type display ──────────────────────────────────────────────────────────────

export const TYPE_BADGE: Record<AccountType, string> = {
  "utility":               "bg-blue-500/15    text-blue-400    border-blue-500/30",
  "data-center-developer": "bg-purple-500/15  text-purple-400  border-purple-500/30",
  "hyperscaler":           "bg-cyan-500/15    text-cyan-400    border-cyan-500/30",
  "industrial-customer":   "bg-orange-500/15  text-orange-400  border-orange-500/30",
  "investor":              "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

export const TYPE_LABEL: Record<AccountType, string> = {
  "utility":               "Utility",
  "data-center-developer": "DC Developer",
  "hyperscaler":           "Hyperscaler",
  "industrial-customer":   "Industrial",
  "investor":              "Investor",
};

export const PRIORITY_COLOR: Record<AccountPriority, string> = {
  strategic: "text-cyan-400",
  high:      "text-orange-400",
  medium:    "text-yellow-400",
  low:       "text-slate-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatRevenue(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(usd / 1_000).toLocaleString()}k`;
}
