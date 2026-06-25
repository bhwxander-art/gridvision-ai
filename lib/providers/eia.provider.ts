/**
 * EIA Open Data provider — U.S. Energy Information Administration
 *
 * Data source: EIA Form 930 – Hourly Electric Grid Monitor
 * Endpoint:    https://api.eia.gov/v2/electricity/rto/region-data/data/
 * Auth:        Free API key — register at https://www.eia.gov/opendata/
 * Env var:     EIA_API_KEY
 *
 * Coverage:    ISO New England (respondent code "ISNE")
 * Granularity: Hourly (hour-beginning, UTC)
 * Latency:     ~1 hour behind wall clock
 * License:     U.S. government open data — no commercial restrictions
 */

import type { LoadProvider, LoadReading } from "./load-provider";

const EIA_BASE = "https://api.eia.gov/v2/electricity/rto/region-data/data/";
const RESPONDENT = "ISNE";
const DATA_TYPE = "D"; // Demand

interface EiaDataPoint {
  period: string;       // "YYYY-MM-DDTHH" (UTC)
  respondent: string;
  type: string;
  value: string | number; // string since EIA API v2.1.6
  "value-units": string;
}

interface EiaResponse {
  response: {
    total?: number;
    data: EiaDataPoint[];
  };
}

/** Convert EIA's "YYYY-MM-DDTHH" UTC period to ISO 8601 */
function periodToISO(period: string): string {
  // period = "2026-06-25T17" → "2026-06-25T17:00:00.000Z"
  return new Date(`${period}:00:00Z`).toISOString();
}

function buildUrl(params: Record<string, string>): string {
  const key = process.env.EIA_API_KEY;
  if (!key) throw new Error("EIA_API_KEY environment variable is not set");

  const q = new URLSearchParams({
    "data[0]": "value",
    "facets[respondent][]": RESPONDENT,
    "facets[type][]": DATA_TYPE,
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    api_key: key,
    ...params,
  });
  return `${EIA_BASE}?${q.toString()}`;
}

async function fetchEia(url: string): Promise<EiaDataPoint[]> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EIA API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const json: EiaResponse = await res.json();
  const points = json?.response?.data ?? [];

  if (!Array.isArray(points)) {
    throw new Error(`EIA API returned unexpected shape: ${JSON.stringify(json).slice(0, 200)}`);
  }

  return points;
}

function toReading(point: EiaDataPoint): LoadReading {
  const mw = parseFloat(String(point.value));
  if (isNaN(mw)) {
    throw new Error(`EIA data point has non-numeric value: ${point.value}`);
  }
  return {
    timestamp: periodToISO(point.period),
    actualLoadMW: Math.round(mw),
    source: "eia",
  };
}

export class EIAProvider implements LoadProvider {
  readonly name = "eia" as const;

  async fetchCurrent(): Promise<LoadReading> {
    const url = buildUrl({ frequency: "hourly", length: "1" });
    const points = await fetchEia(url);

    if (points.length === 0) {
      throw new Error("EIA API returned no data for ISNE");
    }

    return toReading(points[0]);
  }

  async fetchDay(date: Date): Promise<LoadReading[]> {
    const day = date.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const url = buildUrl({
      frequency: "hourly",
      start: day,
      end: day,
      "sort[0][direction]": "asc",
      length: "100",
    });

    const points = await fetchEia(url);

    if (points.length === 0) {
      throw new Error(`EIA API returned no data for ISNE on ${day}`);
    }

    return points.map(toReading);
  }
}
