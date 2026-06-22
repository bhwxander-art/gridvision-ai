/**
 * U.S. Energy Information Administration (EIA) Data Adapter
 *
 * Connects to the EIA Open Data API v2 to ingest:
 *   - Regional electricity demand (MWh) from ISO/RTO reporting
 *   - State-level retail electricity sales (useful for commercial growth proxies)
 *
 * Public API docs:  https://www.eia.gov/opendata/
 * Base URL:         https://api.eia.gov/v2/
 * Authentication:   Free API key — register at https://www.eia.gov/opendata/register.php
 * Rate limit:       5,000 requests / hour with key; 500 / day without key
 *
 * Required environment variables:
 *   EIA_API_KEY  — obtained from eia.gov/opendata
 *
 * Update cadence:
 *   /electricity/rto/region-data — hourly demand, ~1-hour lag, published monthly
 *   /electricity/retail-sales    — monthly sales, published 2 months in arrears
 *
 * Key identifiers used:
 *   respondent = "ISNE"  → ISO New England
 *   type = "D"           → Demand (MWh)
 *   stateid = "MA"       → Massachusetts (retail sales)
 */

import type {
  LoadGrowthDataPoint,
  AnalyticsData,
  ImpactDataPoint,
} from "@/lib/types";
import type { TerritoryLoadForecast, DataProvenance } from "@/lib/domain/models";
import {
  loadGrowthData,
  evImpactData,
  dataCenterImpactData,
  monthlyLoadTrend,
} from "@/lib/sample-data";

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = "https://api.eia.gov/v2";
const FETCH_TIMEOUT_MS = 15_000;
const EIA_ISNE_RESPONDENT = "ISNE";
const EIA_MA_STATE_ID = "MA";

// ── Raw response types (EIA API v2 JSON) ──────────────────────────────────

/**
 * Generic EIA API v2 envelope.
 * The `data` field is an array of records; available fields vary by endpoint.
 */
interface EIAApiResponse<T> {
  response: {
    total: number;
    dateFormat: string;
    frequency: string;
    description?: string;
    data: T[];
  };
}

/** Row shape from /electricity/rto/region-data/data/ */
interface EIARegionalDataRow {
  period: string;             // "2024-01" (monthly) or "2024-01-15T14" (hourly)
  respondent: string;         // "ISNE"
  "respondent-name": string;  // "ISO New England"
  type: string;               // "D" = Demand | "NG" = Net Generation
  "type-name": string;
  value: number | null;       // MWh for the period; null if not yet reported
  "value-units": string;      // "megawatthours"
}

/** Row shape from /electricity/retail-sales/data/ */
interface EIARetailSalesRow {
  period: string;             // "2024-01"
  stateid: string;            // "MA"
  stateDescription: string;   // "Massachusetts"
  sectorid: string;           // "RES" | "COM" | "IND" | "TRA" | "ALL"
  sectorName: string;
  customers: number | null;
  sales: number | null;       // MWh
  revenue: number | null;     // thousand dollars
  "sales-units": string;      // "million kilowatthours"
  "revenue-units": string;
  "customers-units": string;
}

// ── Mock fallback data ─────────────────────────────────────────────────────

const MOCK_ANALYTICS: AnalyticsData = {
  loadGrowth: loadGrowthData,
  evImpact: evImpactData,
  dataCenterImpact: dataCenterImpactData,
  monthlyTrend: monthlyLoadTrend,
};

// ── Helper utilities ───────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.EIA_API_KEY;
  if (!key) {
    throw new Error(
      "[eia.adapter] Missing EIA_API_KEY env var. " +
        "Register for a free key at eia.gov/opendata/register.php"
    );
  }
  return key;
}

async function eiaFetch<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<EIAApiResponse<T>> {
  const apiKey = getApiKey();

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const mergedSignal = signal ?? controller.signal;

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: mergedSignal,
    });
    if (!res.ok) {
      throw new Error(`[eia.adapter] HTTP ${res.status} for ${path}`);
    }
    return (await res.json()) as EIAApiResponse<T>;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildProvenance(quality: DataProvenance["dataQuality"]): DataProvenance {
  return {
    sourceName: "U.S. Energy Information Administration",
    sourceUrl: BASE_URL,
    fetchedAt: new Date().toISOString(),
    dataQuality: quality,
  };
}

// ── Transformation functions (pure — no I/O) ──────────────────────────────

/**
 * Converts annual EIA regional demand rows into LoadGrowthDataPoints.
 *
 * EIA provides MWh/year; peak MW is approximated using:
 *   peakMW ≈ annualMWh / (8760 hours × 0.55 load factor)
 *
 * A 0.55 load factor is a reasonable approximation for New England's mixed
 * weather-sensitive and industrial load profile.  Replace with ISO-NE's
 * published load factor when available.
 */
export function transformRegionalDemandToLoadGrowth(
  rows: EIARegionalDataRow[]
): LoadGrowthDataPoint[] {
  const ISNE_LOAD_FACTOR = 0.55;
  const HOURS_PER_YEAR = 8_760;

  const byYear = new Map<string, number>();

  for (const row of rows) {
    if (row.value === null) continue;
    // period is "YYYY" for annual or "YYYY-MM" for monthly
    const year = row.period.slice(0, 4);
    byYear.set(year, (byYear.get(year) ?? 0) + row.value);
  }

  const sorted = [...byYear.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );

  if (sorted.length === 0) return [];

  const baselineLoad =
    sorted[0][1] / (HOURS_PER_YEAR * ISNE_LOAD_FACTOR) / 1_000; // convert MWh → GWh → peak MW

  return sorted.map(([year, totalMWh]) => {
    const peakMW = Math.round(
      totalMWh / (HOURS_PER_YEAR * ISNE_LOAD_FACTOR) / 1_000
    );
    return {
      year,
      load: peakMW,
      baseline: Math.round(baselineLoad),
    };
  });
}

/**
 * Derives commercial load growth as an ImpactDataPoint from retail sales data.
 *
 * Commercial electricity sales growth (%) is used as a proxy for the
 * GridVision LoadGrowthAssumptions.commercialGrowthPct input.
 */
export function transformRetailSalesToCommercialGrowth(
  rows: EIARetailSalesRow[]
): { commercialGrowthPct: number; latestYear: string } {
  const commercial = rows.filter(
    (r) => r.sectorid === "COM" && r.sales !== null
  );

  if (commercial.length < 2) {
    return { commercialGrowthPct: 0, latestYear: "" };
  }

  // Sort ascending by period
  commercial.sort((a, b) => a.period.localeCompare(b.period));

  const oldest = commercial[0].sales as number;
  const newest = commercial[commercial.length - 1].sales as number;
  const periodSpan =
    parseInt(commercial[commercial.length - 1].period.slice(0, 4)) -
    parseInt(commercial[0].period.slice(0, 4));

  const cagr =
    periodSpan > 0 ? (Math.pow(newest / oldest, 1 / periodSpan) - 1) * 100 : 0;

  return {
    commercialGrowthPct: Math.round(cagr * 10) / 10,
    latestYear: commercial[commercial.length - 1].period.slice(0, 4),
  };
}

/**
 * Converts annual EIA regional demand data into a TerritoryLoadForecast.
 * Historical data is returned; treat as a backward-looking trend.
 */
export function transformDemandToForecast(
  rows: EIARegionalDataRow[]
): TerritoryLoadForecast {
  const dataPoints = transformRegionalDemandToLoadGrowth(rows);
  const withGrowth = dataPoints.map((dp, i) => ({
    year: parseInt(dp.year),
    peakLoadMW: dp.load,
    energyGWh: Math.round(dp.load * 8_760 * 0.55) / 1_000,
    growthPct:
      i === 0
        ? 0
        : Math.round(
            ((dp.load - dataPoints[i - 1].load) / dataPoints[i - 1].load) *
              1_000
          ) / 10,
  }));

  return {
    territoryId: EIA_ISNE_RESPONDENT,
    territoryName: "ISO New England (EIA)",
    forecastedAt: new Date().toISOString(),
    horizonYears: withGrowth.length,
    dataPoints: withGrowth,
    source: "U.S. Energy Information Administration",
  };
}

// ── Public fetch functions ─────────────────────────────────────────────────

/**
 * Fetches annual regional electricity demand for ISO-NE from EIA.
 * Returns up to 10 years of history, sorted ascending.
 * Falls back to mock data on any error.
 */
export async function fetchRegionalLoadGrowth(opts?: {
  signal?: AbortSignal;
}): Promise<LoadGrowthDataPoint[] & { provenance?: DataProvenance }> {
  try {
    const response = await eiaFetch<EIARegionalDataRow>(
      "/electricity/rto/region-data/data/",
      {
        frequency: "annual",
        "data[0]": "value",
        [`facets[respondent][]`]: EIA_ISNE_RESPONDENT,
        [`facets[type][]`]: "D",
        "sort[0][column]": "period",
        "sort[0][direction]": "asc",
        length: "10",
        offset: "0",
      },
      opts?.signal
    );

    const transformed = transformRegionalDemandToLoadGrowth(
      response.response.data
    );
    return Object.assign(transformed, {
      provenance: buildProvenance("live"),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.warn("[eia.adapter] Regional load fetch failed, using mock:", err);
    return Object.assign([...MOCK_ANALYTICS.loadGrowth], {
      provenance: buildProvenance("mock"),
    });
  }
}

/**
 * Fetches Massachusetts retail electricity sales by sector (residential,
 * commercial, industrial) from EIA.  Used to calibrate sector growth rates.
 * Falls back to mock analytics data on any error.
 */
export async function fetchRetailSalesBySector(opts?: {
  signal?: AbortSignal;
}): Promise<AnalyticsData & { provenance: DataProvenance }> {
  try {
    const response = await eiaFetch<EIARetailSalesRow>(
      "/electricity/retail-sales/data/",
      {
        frequency: "annual",
        "data[0]": "sales",
        "data[1]": "customers",
        [`facets[stateid][]`]: EIA_MA_STATE_ID,
        "sort[0][column]": "period",
        "sort[0][direction]": "asc",
        length: "10",
      },
      opts?.signal
    );

    const rows = response.response.data;

    // Derive commercial growth as a proxy for the dataCenterImpact chart
    const { commercialGrowthPct } = transformRetailSalesToCommercialGrowth(rows);

    // Scale the mock impact data by the derived commercial growth factor
    const scaleFactor = 1 + commercialGrowthPct / 100;
    const scaledDCImpact: ImpactDataPoint[] = MOCK_ANALYTICS.dataCenterImpact.map(
      (d) => ({
        ...d,
        impact: Math.round(d.impact * scaleFactor),
      })
    );

    return {
      loadGrowth: MOCK_ANALYTICS.loadGrowth,
      evImpact: MOCK_ANALYTICS.evImpact,
      dataCenterImpact: scaledDCImpact,
      monthlyTrend: MOCK_ANALYTICS.monthlyTrend,
      provenance: buildProvenance("live"),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.warn("[eia.adapter] Retail sales fetch failed, using mock:", err);
    return { ...MOCK_ANALYTICS, provenance: buildProvenance("mock") };
  }
}

/**
 * Fetches the full AnalyticsData bundle from EIA:
 *   - Regional load growth from /electricity/rto/region-data
 *   - Commercial sector proxy from /electricity/retail-sales
 * Falls back to full mock data if either call fails.
 */
export async function fetchEIAAnalyticsData(opts?: {
  signal?: AbortSignal;
}): Promise<AnalyticsData & { provenance: DataProvenance }> {
  try {
    const [loadGrowth, sectorData] = await Promise.all([
      fetchRegionalLoadGrowth(opts),
      fetchRetailSalesBySector(opts),
    ]);

    return {
      loadGrowth,
      evImpact: sectorData.evImpact,
      dataCenterImpact: sectorData.dataCenterImpact,
      monthlyTrend: sectorData.monthlyTrend,
      provenance: buildProvenance("live"),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.warn("[eia.adapter] Full analytics fetch failed, using mock:", err);
    return { ...MOCK_ANALYTICS, provenance: buildProvenance("mock") };
  }
}
