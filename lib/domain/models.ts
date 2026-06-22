/**
 * Canonical domain models for GridVision AI.
 *
 * These are the authoritative shapes that adapters transform external data
 * into.  Services and API routes consume these types; UI components consume
 * the narrower types in lib/types.ts.
 *
 * Naming convention: models here represent real-world utility-domain entities.
 * Types in lib/types.ts represent GridVision UI / wire formats.
 */

// Re-export GridLoad so adapters import from one place
export type { GridLoad } from "@/lib/types";

// ── Territory load forecasting ────────────────────────────────────────────

/**
 * Multi-year peak-load and energy forecast for a single ISO/RTO territory.
 * Produced by ISO-NE or an IRP model; consumed by the analytics charts.
 */
export interface TerritoryLoadForecast {
  /** Unique identifier for the territory (e.g. "ISNE", "NEPOOL") */
  territoryId: string;
  /** Human-readable territory name */
  territoryName: string;
  /** ISO 8601 timestamp when this forecast was published */
  forecastedAt: string;
  /** Number of years covered by the forecast */
  horizonYears: number;
  /** Annual data points sorted ascending by year */
  dataPoints: Array<{
    year: number;
    /** Forecast peak demand in MW */
    peakLoadMW: number;
    /** Forecast annual energy consumption in GWh */
    energyGWh: number;
    /** Year-over-year growth vs previous period */
    growthPct: number;
  }>;
  /** Which data source produced this forecast */
  source: string;
  /** Optional 80% confidence interval bounds (parallel arrays with dataPoints) */
  confidenceInterval?: {
    lowerMW: number[];
    upperMW: number[];
  };
}

// ── Utility territory ─────────────────────────────────────────────────────

/**
 * Rich representation of a utility's service territory.
 * Superset of PlanningTerritory — includes regulatory identifiers needed
 * to query external APIs (EIA code, ISO/RTO respondent ID, FIPS code).
 */
export interface UtilityTerritory {
  /** Internal GridVision identifier */
  id: string;
  /** Display name of the territory */
  name: string;
  /** Operating utility company name */
  operatingCompany: string;
  /** Two-letter US state abbreviation (primary state of service) */
  state: string;
  /** Two-digit FIPS state code (e.g. "25" for Massachusetts) */
  stateFipsCode: string;
  /** NERC reliability region (e.g. "NPCC") */
  nercRegion: string;
  /** ISO or RTO respondent identifier used in EIA API (e.g. "ISNE") */
  isoRtoId: string;
  /** EIA utility identifier for retail sales queries */
  eiaUtilityCode: string;
  /** Most recent reported peak demand (MW) */
  peakLoadMW: number;
  /** Most recent annual energy consumption (GWh) */
  annualEnergyGWh: number;
  /** Approximate number of metered customers */
  customersCount: number;
  /** Service area in square miles */
  serviceAreaSqMi: number;
  /** WGS-84 centroid latitude of service territory */
  latitude: number;
  /** WGS-84 centroid longitude of service territory */
  longitude: number;
}

// ── Population growth ─────────────────────────────────────────────────────

/**
 * Population growth metrics derived from Census Bureau ACS estimates.
 * Used to compute LoadGrowthAssumptions.populationGrowthPct.
 */
export interface PopulationGrowthMetrics {
  /** Name of the geographic unit (typically county + state) */
  territoryName: string;
  /** Two-letter US state abbreviation */
  state: string;
  /** Five-digit FIPS county code (state + county concatenated) */
  fipsCode: string;
  /** Population for the survey year */
  currentPopulation: number;
  /** Population for the comparison year (typically currentYear - 1 or - 5) */
  previousPopulation: number;
  /**
   * Compound annual growth rate (%).
   * Positive = growth; negative = decline.
   */
  annualGrowthPct: number;
  /** Total housing units */
  householdCount: number;
  /** Median household income in USD */
  medianHouseholdIncomeUSD: number;
  /** ACS survey year for currentPopulation (e.g. 2023) */
  dataYear: number;
  /** ACS survey year for previousPopulation */
  comparisonYear: number;
  /** Which Census dataset produced this record */
  source: string;
}

// ── Shared metadata ───────────────────────────────────────────────────────

/**
 * Provenance record attached to any external data fetch.
 * Lets the UI display a "data source" chip without coupling to adapter internals.
 */
export interface DataProvenance {
  /** Human-readable source name, e.g. "ISO New England" */
  sourceName: string;
  /** Base URL of the API that was called */
  sourceUrl: string;
  /** ISO 8601 timestamp when the data was fetched */
  fetchedAt: string;
  /**
   * Whether the data was served from the real API or a fallback.
   * "live"  — successfully fetched from external API
   * "cache" — served from a short-term cache
   * "mock"  — external API was unavailable; using mock data
   */
  dataQuality: "live" | "cache" | "mock";
}
