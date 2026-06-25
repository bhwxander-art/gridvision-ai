/**
 * ISO New England Web Services provider
 *
 * Data source: ISO-NE Web Services API v1.1
 * Base URL:    https://webservices.iso-ne.com/api/v1.1
 * Auth:        HTTP Basic (ISO Express account — free at iso-ne.com/isoexpress)
 * Env vars:    ISONE_USERNAME, ISONE_PASSWORD
 *
 * Coverage:    New England control area
 * Granularity: 5-minute intervals
 * Latency:     ~5–10 minutes
 *
 * Registration:
 *   1. Go to https://www.iso-ne.com/isoexpress/login → Register
 *   2. Use the same email/password here as ISONE_USERNAME / ISONE_PASSWORD
 *   3. ISO Express accounts are automatically granted access to public data
 *
 * Activation:
 *   Set ISONE_USERNAME and ISONE_PASSWORD in Vercel environment variables.
 *   The provider factory (lib/providers/index.ts) will prefer this provider
 *   over EIA automatically — no other code changes required.
 */

import type { LoadProvider, LoadReading } from "./load-provider";

const ISONE_BASE = "https://webservices.iso-ne.com/api/v1.1";

interface IsoNeLoad {
  BeginDate: string;  // ISO 8601 with Eastern offset e.g. "2026-06-25T18:00:00.000-04:00"
  Mw: number;
}

interface IsoNeSingleResponse {
  FiveMinSystemLoads: {
    FiveMinSystemLoad: IsoNeLoad | IsoNeLoad[];
  };
}

function basicAuth(): string {
  const user = process.env.ISONE_USERNAME;
  const pass = process.env.ISONE_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "ISONE_USERNAME and ISONE_PASSWORD are required for the ISO-NE provider. " +
      "Register a free ISO Express account at https://www.iso-ne.com/isoexpress/login"
    );
  }
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function fetchIsone(path: string): Promise<IsoNeSingleResponse> {
  const res = await fetch(`${ISONE_BASE}${path}`, {
    headers: {
      Authorization: basicAuth(),
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  });

  if (res.status === 401) {
    throw new Error(
      "ISO-NE API authentication failed — check ISONE_USERNAME and ISONE_PASSWORD"
    );
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ISO-NE API error ${res.status}: ${body.slice(0, 200)}`);
  }

  try {
    return await res.json();
  } catch {
    throw new Error(`ISO-NE API returned non-JSON response (status ${res.status})`);
  }
}

function toReading(load: IsoNeLoad): LoadReading {
  return {
    timestamp: new Date(load.BeginDate).toISOString(),
    actualLoadMW: Math.round(load.Mw),
    source: "iso-ne",
  };
}

export class ISONeProvider implements LoadProvider {
  readonly name = "iso-ne" as const;

  async fetchCurrent(): Promise<LoadReading> {
    const data = await fetchIsone("/fiveminutesystemload/current.json");
    const raw = data?.FiveMinSystemLoads?.FiveMinSystemLoad;

    if (!raw) throw new Error("ISO-NE API returned unexpected shape for current load");

    const load = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    return toReading(load);
  }

  async fetchDay(date: Date): Promise<LoadReading[]> {
    const day = date.toISOString().slice(0, 10).replace(/-/g, ""); // "YYYYMMDD"
    const data = await fetchIsone(`/fiveminutesystemload/day/${day}.json`);
    const raw = data?.FiveMinSystemLoads?.FiveMinSystemLoad;

    if (!raw) throw new Error(`ISO-NE API returned no data for day ${day}`);

    const loads = Array.isArray(raw) ? raw : [raw];
    return loads.map(toReading);
  }
}
