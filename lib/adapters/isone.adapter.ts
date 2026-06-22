/**
 * ISO New England (ISO-NE) Data Adapter
 *
 * Connects to the ISO-NE OASIS/Webservices API to ingest:
 *   - Real-time system load (5-minute and hourly intervals)
 *   - Day-ahead and seasonal peak-load forecasts
 *
 * Public API docs:  https://webservices.iso-ne.com/docs/
 * Base URL:         https://webservices.iso-ne.com/api/v1.1/
 * Authentication:   HTTP Basic (free account at iso-ne.com/participate/support/web-services-data)
 *
 * Required environment variables:
 *   ISONE_API_USER      — registered ISO-NE web-services username
 *   ISONE_API_PASSWORD  — corresponding password
 *
 * Update cadence:
 *   /fiveminutesystemload   — 5-minute intervals, ~5 min lag
 *   /currenthourlyload      — hourly, updated each hour
 *   /hourlylocalpeakforecast — day-ahead, issued daily at midnight
 */

import type { GridLoad, TerritoryLoadForecast, DataProvenance } from "@/lib/domain/models";

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = "https://webservices.iso-ne.com/api/v1.1";
const FETCH_TIMEOUT_MS = 10_000;
const ISONE_TERRITORY_ID = "ISNE";
const ISONE_TERRITORY_NAME = "ISO New England";

// ── Raw response types (ISO-NE JSON format) ───────────────────────────────

/** Shape of a single record from /fiveminutesystemload */
interface RawFiveMinLoad {
  BeginDate: string;    // "2024-07-15T14:25:00.000-04:00"
  Mw: number;           // 14612.0
}

interface RawFiveMinLoadResponse {
  FiveMinSystemLoads: {
    FiveMinSystemLoad: RawFiveMinLoad[];
  };
}

/** Shape of a single record from /currenthourlyload */
interface RawHourlyLoad {
  BeginDate: string;      // "2024-07-15T14:00:00.000-04:00"
  LoadMw: number;         // 14523.0 — includes Actual Responsive Demand
  NativeLoadMw: number;   // 14100.0 — native load (excludes ARD)
  ArdMw: number;          // 423.0   — Actual Responsive Demand
}

interface RawHourlyLoadResponse {
  HourlySystemLoads: {
    HourlySystemLoad: RawHourlyLoad[];
  };
}

/** Single area row from /hourlylocalpeakforecast */
interface RawAreaForecast {
  ForecastDate: string;       // "2024-07-16"
  AreaCode: number;           // 4001 (NEPOOL)
  AreaName: string;           // "NEPOOL"
  CreationDate: string;       // "2024-07-15T00:00:00"
  /** Array of 24 hourly MW values for the forecast day */
  HourlyLoadForecast: number[];
}

interface RawLocalPeakForecastResponse {
  HourlyLclPkFcsts: {
    HourlyLclPkFcst: RawAreaForecast[];
  };
}

// ── Mock fallback data ─────────────────────────────────────────────────────

const MOCK_GRID_LOAD: GridLoad = {
  source: "ISO New England (mock)",
  currentLoad: 14842,
  timestamp: new Date().toISOString(),
};

const MOCK_LOAD_FORECAST: TerritoryLoadForecast = {
  territoryId: ISONE_TERRITORY_ID,
  territoryName: ISONE_TERRITORY_NAME,
  forecastedAt: new Date().toISOString(),
  horizonYears: 6,
  source: "ISO New England (mock)",
  dataPoints: [
    { year: 2024, peakLoadMW: 24_900, energyGWh: 128_000, growthPct: 0 },
    { year: 2025, peakLoadMW: 25_300, energyGWh: 130_200, growthPct: 1.6 },
    { year: 2026, peakLoadMW: 26_100, energyGWh: 133_800, growthPct: 3.2 },
    { year: 2027, peakLoadMW: 27_400, energyGWh: 140_400, growthPct: 5.0 },
    { year: 2028, peakLoadMW: 29_200, energyGWh: 149_600, growthPct: 6.6 },
    { year: 2029, peakLoadMW: 31_500, energyGWh: 161_400, growthPct: 7.9 },
  ],
};

// ── Helper utilities ───────────────────────────────────────────────────────

/**
 * Reads ISO-NE credentials from environment variables.
 * Throws a descriptive error if either variable is absent — this surfaces
 * quickly in logs rather than with a cryptic 401.
 */
function getCredentials(): { user: string; password: string } {
  const user = process.env.ISONE_API_USER;
  const password = process.env.ISONE_API_PASSWORD;
  if (!user || !password) {
    throw new Error(
      "[isone.adapter] Missing ISONE_API_USER or ISONE_API_PASSWORD env vars. " +
        "Register at iso-ne.com/participate/support/web-services-data"
    );
  }
  return { user, password };
}

/** Builds a Basic-Auth Authorization header value. */
function basicAuthHeader(user: string, password: string): string {
  return "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
}

/** Fetches a URL with a hard timeout and ISO-NE auth headers. */
async function isoneFetch<T>(
  path: string,
  signal?: AbortSignal
): Promise<T> {
  const { user, password } = getCredentials();

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    FETCH_TIMEOUT_MS
  );
  // Merge caller signal with our timeout signal
  const mergedSignal = signal ?? controller.signal;

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: basicAuthHeader(user, password),
        Accept: "application/json",
      },
      signal: mergedSignal,
    });

    if (!res.ok) {
      throw new Error(`[isone.adapter] HTTP ${res.status} for ${path}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildProvenance(quality: DataProvenance["dataQuality"]): DataProvenance {
  return {
    sourceName: ISONE_TERRITORY_NAME,
    sourceUrl: BASE_URL,
    fetchedAt: new Date().toISOString(),
    dataQuality: quality,
  };
}

// ── Transformation functions (pure — no I/O) ──────────────────────────────

/**
 * Converts the most recent ISO-NE hourly load record into a GridLoad.
 * Uses NativeLoadMw (excludes Actual Responsive Demand curtailment).
 */
export function transformHourlyLoad(
  raw: RawHourlyLoadResponse
): GridLoad {
  const records = raw.HourlySystemLoads?.HourlySystemLoad ?? [];
  if (records.length === 0) {
    throw new Error("[isone.adapter] transformHourlyLoad: empty payload");
  }
  // ISO-NE returns most-recent first
  const latest = records[0];
  return {
    source: "ISO New England",
    currentLoad: latest.NativeLoadMw,
    timestamp: new Date(latest.BeginDate).toISOString(),
  };
}

/**
 * Converts the most recent 5-minute system load record into a GridLoad.
 * More current than the hourly endpoint but slightly noisier.
 */
export function transformFiveMinLoad(
  raw: RawFiveMinLoadResponse
): GridLoad {
  const records = raw.FiveMinSystemLoads?.FiveMinSystemLoad ?? [];
  if (records.length === 0) {
    throw new Error("[isone.adapter] transformFiveMinLoad: empty payload");
  }
  const latest = records[0];
  return {
    source: "ISO New England (5-min)",
    currentLoad: latest.Mw,
    timestamp: new Date(latest.BeginDate).toISOString(),
  };
}

/**
 * Converts ISO-NE daily local-peak forecasts into a TerritoryLoadForecast.
 * Only NEPOOL (area code 4001) records are used; zone-level records are ignored.
 * Day-ahead peak is estimated as the maximum hourly value across the forecast day.
 */
export function transformLocalPeakForecast(
  raw: RawLocalPeakForecastResponse
): TerritoryLoadForecast {
  const records = (raw.HourlyLclPkFcsts?.HourlyLclPkFcst ?? [])
    .filter((r) => r.AreaCode === 4001) // NEPOOL system-wide
    .sort((a, b) => a.ForecastDate.localeCompare(b.ForecastDate));

  const dataPoints = records.map((r) => {
    const peakLoadMW = Math.max(...r.HourlyLoadForecast);
    // Approximate annual energy from daily peak using a 0.55 system load factor
    const energyGWh = Math.round((peakLoadMW * 8_760 * 0.55) / 1_000);
    return {
      year: new Date(r.ForecastDate).getFullYear(),
      peakLoadMW: Math.round(peakLoadMW),
      energyGWh,
      growthPct: 0, // computed after collecting all years
    };
  });

  // Back-fill growthPct now that we have all data points
  for (let i = 1; i < dataPoints.length; i++) {
    const prev = dataPoints[i - 1].peakLoadMW;
    const curr = dataPoints[i].peakLoadMW;
    dataPoints[i].growthPct =
      prev > 0 ? Math.round(((curr - prev) / prev) * 1_000) / 10 : 0;
  }

  return {
    territoryId: ISONE_TERRITORY_ID,
    territoryName: ISONE_TERRITORY_NAME,
    forecastedAt: new Date().toISOString(),
    horizonYears: dataPoints.length,
    dataPoints,
    source: "ISO New England",
  };
}

// ── Public fetch functions ─────────────────────────────────────────────────

/**
 * Fetches the most recent system-wide load reading from ISO-NE.
 * Tries 5-minute data first (freshest); falls back to hourly on failure.
 * Returns mock data if both sources are unavailable.
 *
 * @param opts.signal  Optional AbortSignal from the caller
 * @returns GridLoad with provenance attached via `.provenance`
 */
export async function fetchISONeGridLoad(opts?: {
  signal?: AbortSignal;
}): Promise<GridLoad & { provenance: DataProvenance }> {
  // 1. Try 5-minute load (freshest available)
  try {
    const raw = await isoneFetch<RawFiveMinLoadResponse>(
      "/fiveminutesystemload/current",
      opts?.signal
    );
    return {
      ...transformFiveMinLoad(raw),
      provenance: buildProvenance("live"),
    };
  } catch (fiveMinErr) {
    if (
      fiveMinErr instanceof DOMException &&
      fiveMinErr.name === "AbortError"
    ) {
      throw fiveMinErr;
    }
    console.warn("[isone.adapter] 5-min load failed, trying hourly:", fiveMinErr);
  }

  // 2. Fall back to hourly load
  try {
    const raw = await isoneFetch<RawHourlyLoadResponse>(
      "/currenthourlyload",
      opts?.signal
    );
    return {
      ...transformHourlyLoad(raw),
      provenance: buildProvenance("live"),
    };
  } catch (hourlyErr) {
    if (
      hourlyErr instanceof DOMException &&
      hourlyErr.name === "AbortError"
    ) {
      throw hourlyErr;
    }
    console.warn("[isone.adapter] Hourly load failed, using mock:", hourlyErr);
  }

  // 3. Return mock fallback
  return {
    ...MOCK_GRID_LOAD,
    timestamp: new Date().toISOString(),
    provenance: buildProvenance("mock"),
  };
}

/**
 * Fetches the day-ahead local-peak load forecast from ISO-NE.
 * Returns mock data if the API is unavailable.
 */
export async function fetchISONeLoadForecast(opts?: {
  signal?: AbortSignal;
}): Promise<TerritoryLoadForecast & { provenance: DataProvenance }> {
  try {
    const raw = await isoneFetch<RawLocalPeakForecastResponse>(
      "/hourlylocalpeakforecast",
      opts?.signal
    );
    return {
      ...transformLocalPeakForecast(raw),
      provenance: buildProvenance("live"),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.warn("[isone.adapter] Load forecast fetch failed, using mock:", err);
    return {
      ...MOCK_LOAD_FORECAST,
      forecastedAt: new Date().toISOString(),
      provenance: buildProvenance("mock"),
    };
  }
}
