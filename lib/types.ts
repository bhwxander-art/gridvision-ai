import type { PlanningHorizon, DataCenterInterconnection } from "@/lib/planning-engine";

// ── Core grid types ────────────────────────────────────────────────────────
export interface GridLoad {
  source: string;
  currentLoad: number;
  timestamp: string;
}

// ── Planning configuration ─────────────────────────────────────────────────
export interface PlanningTerritory {
  name: string;
  operatingCompany: string;
  planningHorizonYears: PlanningHorizon;
  lastModelRun: string;
  peakSystemLoadMW: number;
}

export interface LoadGrowthAssumptions {
  evPenetrationGrowthPct: number;
  populationGrowthPct: number;
  commercialGrowthPct: number;
  dataCenterQueueMW: number;
}

export interface PlanningConfig {
  territory: PlanningTerritory;
  loadGrowthAssumptions: LoadGrowthAssumptions;
}

// ── Asset types ────────────────────────────────────────────────────────────
// Canonical simple-map Substation (marketing layer)
export interface Substation {
  id: string;
  name: string;
  status: "normal" | "warning" | "capacity-risk";
  load: number;
  capacity: number;
  /** WGS-84 decimal degrees north */
  latitude: number;
  /** WGS-84 decimal degrees east (negative for western hemisphere) */
  longitude: number;
  region: string;
}

// Transformer is the canonical name for TransformerAsset
export type { TransformerAsset as Transformer } from "@/lib/planning-engine";

// Re-export planning-engine types so consumers can import from one place
export type {
  DataCenterInterconnection,
  SubstationPlan,
  FeederCircuit,
  SubstationCapacityResult,
  TransformerOverloadResult,
  DataCenterImpactResult,
  ConstraintSeverity,
} from "@/lib/planning-engine";

// ── Analytics / trend data ─────────────────────────────────────────────────
export interface TransformerLoadingPoint {
  year: string;
  cambridge: number;
  somerville: number;
  waltham: number;
  boston: number;
}

export interface LoadGrowthDataPoint {
  year: string;
  load: number;
  baseline: number;
}

export interface ImpactDataPoint {
  category: string;
  impact: number;
  fill: string;
}

export interface MonthlyLoadPoint {
  month: string;
  total: number;
  ev: number;
  datacenter: number;
}

export interface AnalyticsData {
  loadGrowth: LoadGrowthDataPoint[];
  evImpact: ImpactDataPoint[];
  dataCenterImpact: ImpactDataPoint[];
  monthlyTrend: MonthlyLoadPoint[];
}

// ── API response types ─────────────────────────────────────────────────────

/** Returned by GET /api/grid */
export interface GridStatusResponse {
  currentLoad: number;
  peakCapacityMW: number;
  utilizationPct: number;
  substationSummary: {
    total: number;
    constrained: number;
    critical: number;
  };
  dcQueueMW: number;
  source: string;
  timestamp: string;
  freshness: "live" | "delayed" | "mock";
  isMock: boolean;
}

/** Returned by GET /api/datacenters */
export interface DataCenterQueueResponse {
  queue: DataCenterInterconnection[];
  _provenance: import("@/lib/provenance").ProvenanceInfo;
}
