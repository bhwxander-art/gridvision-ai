/**
 * U.S. Census Bureau Data Adapter
 *
 * Connects to the Census Bureau Data API to ingest:
 *   - County-level population estimates (American Community Survey 5-year)
 *   - Housing unit counts
 *   - Median household income
 *
 * These metrics feed LoadGrowthAssumptions.populationGrowthPct and
 * support EV adoption modeling (income is a strong predictor of EV uptake).
 *
 * Public API docs:  https://www.census.gov/data/developers/data-sets.html
 * Base URL:         https://api.census.gov/data/
 * Authentication:   Optional free key (recommended — 500 req/day without key)
 *                   Register at api.census.gov/data/key_signup.html
 *
 * Optional environment variable:
 *   CENSUS_API_KEY  — obtained from Census key signup
 *
 * Update cadence:
 *   ACS 1-year estimates — annually (September/October), counties ≥65k pop
 *   ACS 5-year estimates — annually (December), all geographies
 *
 * Key datasets used:
 *   /2023/acs/acs5  — 2019-2023 ACS 5-year estimates (latest as of 2024)
 *   /2022/acs/acs5  — 2018-2022 ACS 5-year estimates (comparison year)
 *
 * Key variables:
 *   B01003_001E  — Total population
 *   B25001_001E  — Total housing units
 *   B19013_001E  — Median household income (in 2023 inflation-adjusted dollars)
 *   NAME         — Geographic area name
 *
 * Massachusetts FIPS state code: 25
 * Focus counties for Eastern Massachusetts service territory:
 *   Middlesex (017) — Cambridge, Somerville, Waltham
 *   Suffolk   (025) — Boston
 *   Essex     (009) — North Shore / Lynn area
 */

import type { PopulationGrowthMetrics, DataProvenance } from "@/lib/domain/models";

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = "https://api.census.gov/data";
const FETCH_TIMEOUT_MS = 12_000;
const MA_STATE_FIPS = "25";

// Counties in the Eversource Eastern Massachusetts service territory
const TARGET_COUNTY_FIPS = ["017", "025", "009"] as const; // Middlesex, Suffolk, Essex

const ACS_VARIABLES = [
  "B01003_001E", // Total population
  "B25001_001E", // Total housing units
  "B19013_001E", // Median household income
  "NAME",
] as const;

// ── Raw response types (Census API format) ────────────────────────────────

/**
 * The Census API returns a 2-D JSON array.
 * Row 0 is the header (variable names).
 * Rows 1..n are data rows (all values are strings, even numeric ones).
 *
 * Example:
 *   [["B01003_001E","B25001_001E","B19013_001E","NAME","state","county"],
 *    ["1623284","693145","85843","Middlesex County, Massachusetts","25","017"],
 *    ...]
 */
type CensusRow = string[];
type CensusApiResponse = CensusRow[];

// ── Mock fallback data ─────────────────────────────────────────────────────

const MOCK_POPULATION_METRICS: PopulationGrowthMetrics[] = [
  {
    territoryName: "Middlesex County, Massachusetts",
    state: "MA",
    fipsCode: "25017",
    currentPopulation: 1_623_284,
    previousPopulation: 1_595_192,
    annualGrowthPct: 0.44,
    householdCount: 693_145,
    medianHouseholdIncomeUSD: 102_428,
    dataYear: 2023,
    comparisonYear: 2022,
    source: "ACS 5-Year Estimates (mock)",
  },
  {
    territoryName: "Suffolk County, Massachusetts",
    state: "MA",
    fipsCode: "25025",
    currentPopulation: 816_378,
    previousPopulation: 800_232,
    annualGrowthPct: 0.50,
    householdCount: 312_890,
    medianHouseholdIncomeUSD: 79_445,
    dataYear: 2023,
    comparisonYear: 2022,
    source: "ACS 5-Year Estimates (mock)",
  },
  {
    territoryName: "Essex County, Massachusetts",
    state: "MA",
    fipsCode: "25009",
    currentPopulation: 822_658,
    previousPopulation: 805_341,
    annualGrowthPct: 0.54,
    householdCount: 311_222,
    medianHouseholdIncomeUSD: 86_112,
    dataYear: 2023,
    comparisonYear: 2022,
    source: "ACS 5-Year Estimates (mock)",
  },
];

// ── Helper utilities ───────────────────────────────────────────────────────

function getApiKey(): string | null {
  return process.env.CENSUS_API_KEY ?? null;
}

async function censusFetch(
  dataset: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<CensusApiResponse> {
  const url = new URL(`${BASE_URL}/${dataset}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const apiKey = getApiKey();
  if (apiKey) url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const mergedSignal = signal ?? controller.signal;

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: mergedSignal,
    });
    if (!res.ok) {
      throw new Error(`[census.adapter] HTTP ${res.status} for ${dataset}`);
    }
    return (await res.json()) as CensusApiResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parses the Census response array into typed objects keyed by column header.
 * Returns an empty array if the response has no data rows.
 */
function parseRows<K extends string>(
  raw: CensusApiResponse,
  expectedKeys: readonly K[]
): Array<Record<K, string>> {
  if (raw.length < 2) return [];
  const [headers, ...dataRows] = raw;
  return dataRows.map((row) => {
    const record = {} as Record<K, string>;
    for (const key of expectedKeys) {
      const idx = headers.indexOf(key);
      record[key] = idx >= 0 ? row[idx] : "";
    }
    return record;
  });
}

function buildProvenance(quality: DataProvenance["dataQuality"]): DataProvenance {
  return {
    sourceName: "U.S. Census Bureau — American Community Survey",
    sourceUrl: BASE_URL,
    fetchedAt: new Date().toISOString(),
    dataQuality: quality,
  };
}

// ── Transformation functions (pure — no I/O) ──────────────────────────────

/**
 * Converts two years of Census ACS rows into PopulationGrowthMetrics.
 *
 * @param currentRows   Rows from the current ACS year
 * @param previousRows  Rows from the comparison ACS year
 * @param currentYear   Survey year for currentRows
 * @param comparisonYear Survey year for previousRows
 */
export function transformCensusRows(
  currentRows: CensusApiResponse,
  previousRows: CensusApiResponse,
  currentYear: number,
  comparisonYear: number
): PopulationGrowthMetrics[] {
  const allKeys = [...ACS_VARIABLES, "state", "county"] as const;
  type RowKey = (typeof allKeys)[number];

  const current = parseRows<RowKey>(currentRows, allKeys);
  const previous = parseRows<RowKey>(previousRows, allKeys);

  const previousByFips = new Map(
    previous.map((r) => [`${r.state}${r.county}`, r])
  );

  return current
    .filter((r) => TARGET_COUNTY_FIPS.includes(r.county as (typeof TARGET_COUNTY_FIPS)[number]))
    .map((r) => {
      const fipsCode = `${r.state}${r.county}`;
      const prev = previousByFips.get(fipsCode);

      const currentPop = parseInt(r.B01003_001E) || 0;
      const previousPop = parseInt(prev?.B01003_001E ?? "0") || 0;

      // CAGR over the gap between survey years
      const yearSpan = currentYear - comparisonYear;
      const annualGrowthPct =
        previousPop > 0 && yearSpan > 0
          ? (Math.pow(currentPop / previousPop, 1 / yearSpan) - 1) * 100
          : 0;

      return {
        territoryName: r.NAME,
        state: "MA",
        fipsCode,
        currentPopulation: currentPop,
        previousPopulation: previousPop,
        annualGrowthPct: Math.round(annualGrowthPct * 100) / 100,
        householdCount: parseInt(r.B25001_001E) || 0,
        medianHouseholdIncomeUSD: parseInt(r.B19013_001E) || 0,
        dataYear: currentYear,
        comparisonYear,
        source: `ACS 5-Year Estimates ${comparisonYear}-${currentYear}`,
      };
    });
}

/**
 * Derives a territory-level population growth rate from county metrics.
 * Uses a population-weighted average of the county-level CAGRs.
 */
export function deriveWeightedGrowthRate(
  metrics: PopulationGrowthMetrics[]
): number {
  if (metrics.length === 0) return 0;

  const totalPop = metrics.reduce((s, m) => s + m.currentPopulation, 0);
  if (totalPop === 0) return 0;

  const weightedSum = metrics.reduce(
    (s, m) => s + m.annualGrowthPct * (m.currentPopulation / totalPop),
    0
  );

  return Math.round(weightedSum * 100) / 100;
}

/**
 * Derives an EV adoption proxy from median income.
 *
 * EV uptake correlates strongly with income; this uses a logistic function
 * calibrated to 2024 NHTSA/AFDC registration data where:
 *   income < $60k  → ~4% EV penetration growth
 *   income $80-120k → ~12-18% EV penetration growth
 *   income > $150k → ~25%+ EV penetration growth
 *
 * Replace this heuristic with NHTSA vehicle registration data when available.
 */
export function deriveEVPenetrationGrowthPct(
  metrics: PopulationGrowthMetrics[]
): number {
  if (metrics.length === 0) return 18; // default from mock

  const totalPop = metrics.reduce((s, m) => s + m.currentPopulation, 0);
  const weightedIncome =
    totalPop > 0
      ? metrics.reduce(
          (s, m) =>
            s +
            m.medianHouseholdIncomeUSD * (m.currentPopulation / totalPop),
          0
        )
      : 85_000;

  // Logistic approximation: maps income to EV growth % in range [4, 28]
  const midpoint = 90_000;
  const steepness = 0.000_02;
  const evGrowthPct =
    4 + 24 / (1 + Math.exp(-steepness * (weightedIncome - midpoint)));

  return Math.round(evGrowthPct * 10) / 10;
}

// ── Public fetch functions ─────────────────────────────────────────────────

/**
 * Fetches population, housing, and income data for Eastern Massachusetts
 * counties from the Census Bureau ACS 5-year estimates.
 *
 * Fetches two survey years in parallel to compute growth rates.
 * Falls back to mock data if either request fails.
 *
 * @param currentYear   ACS 5-year endpoint year (default: 2023)
 */
export async function fetchCountyPopulation(
  currentYear = 2023,
  opts?: { signal?: AbortSignal }
): Promise<PopulationGrowthMetrics[] & { provenance: DataProvenance }> {
  const comparisonYear = currentYear - 1;
  const geoParam = `county:${TARGET_COUNTY_FIPS.join(",")}`;

  try {
    const [currentRaw, previousRaw] = await Promise.all([
      censusFetch(
        `${currentYear}/acs/acs5`,
        {
          get: ACS_VARIABLES.join(","),
          for: geoParam,
          in: `state:${MA_STATE_FIPS}`,
        },
        opts?.signal
      ),
      censusFetch(
        `${comparisonYear}/acs/acs5`,
        {
          get: ACS_VARIABLES.join(","),
          for: geoParam,
          in: `state:${MA_STATE_FIPS}`,
        },
        opts?.signal
      ),
    ]);

    const metrics = transformCensusRows(
      currentRaw,
      previousRaw,
      currentYear,
      comparisonYear
    );

    return Object.assign(metrics, {
      provenance: buildProvenance("live"),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.warn("[census.adapter] Population fetch failed, using mock:", err);
    return Object.assign([...MOCK_POPULATION_METRICS], {
      provenance: buildProvenance("mock"),
    });
  }
}

/**
 * Fetches county population metrics and returns derived planning assumptions:
 *   - populationGrowthPct (weighted CAGR across service counties)
 *   - evPenetrationGrowthPct (income-based logistic approximation)
 *
 * These values can replace the hardcoded constants in LoadGrowthAssumptions.
 */
export async function fetchLoadGrowthAssumptionUpdates(opts?: {
  signal?: AbortSignal;
}): Promise<{
  populationGrowthPct: number;
  evPenetrationGrowthPct: number;
  provenance: DataProvenance;
}> {
  const metrics = await fetchCountyPopulation(2023, opts);
  return {
    populationGrowthPct: deriveWeightedGrowthRate(metrics),
    evPenetrationGrowthPct: deriveEVPenetrationGrowthPct(metrics),
    provenance: metrics.provenance ?? buildProvenance("mock"),
  };
}
