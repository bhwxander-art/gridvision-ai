/**
 * EIA Operating Generator Capacity — API fetcher (INFRA-006)
 *
 * Endpoint: /electricity/operating-generator-capacity/data/ (annual)
 * Auth:     EIA_API_KEY environment variable
 * Pagination: EIA hard-caps responses at 5,000 rows; this fetcher pages
 *             automatically until all rows for the requested BA codes are retrieved.
 *
 * The `httpFetch` parameter is injectable so unit tests can supply mock
 * responses without making real HTTP calls.
 */

import "server-only";
import type { DbEiaGeneratorInsert } from "@/lib/db/types-eia-generators";
import {
  mapFuelType,
  mapGeneratorStatus,
  parseCapacityMw,
  parseNullableFloat,
  parseYear,
  parseMonth,
} from "./normalizer";

// ── EIA API constants ─────────────────────────────────────────────────────────

const EIA_BASE_URL = "https://api.eia.gov/v2";
const EIA_GENERATOR_PATH = "/electricity/operating-generator-capacity/data/";
const EIA_PAGE_SIZE = 5_000; // EIA API max per request
const DEFAULT_TIMEOUT_MS = 30_000;

// ── Raw API row shape ─────────────────────────────────────────────────────────

interface EiaApiEnvelope {
  response: {
    total?: number;
    data: EiaRawRow[];
  };
}

interface EiaRawRow {
  period: string;                   // "2024"
  stateid?: string;                 // "MA"
  stateDescription?: string;
  county?: string;
  latitude?: string | number;
  longitude?: string | number;
  balancingAuthorityCode?: string;  // "ISNE"
  entityid?: string;
  entityName?: string;
  plantCode?: string;               // EIA plant code
  generatorId?: string;
  plantName?: string;
  technology?: string;              // "Natural Gas Fired Combined Cycle"
  primeMoverCode?: string;          // "CC"
  "energy-source-code"?: string;   // "NG"
  statusCode?: string;              // "OP"
  statusDescription?: string;
  "nameplate-capacity-mw"?: string | number;
  "summer-capacity-mw"?: string | number;
  "winter-capacity-mw"?: string | number;
  operatingYear?: string | number;
  operatingMonth?: string | number;
  retirementYear?: string | number;
  retirementMonth?: string | number;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface FetchGeneratorsOptions {
  /** Balancing authority codes to fetch. Omit or pass empty array to fetch all. */
  baCodes?: string[];
  /** Override data year (defaults to most-recently-completed calendar year). */
  dataYear?: number;
  /** Milliseconds before aborting a single page fetch. Defaults to 30,000. */
  timeoutMs?: number;
  /** Override the EIA endpoint URL (for tests). */
  url?: string;
}

export interface GeneratorFetchResult {
  rows: DbEiaGeneratorInsert[];
  /** Total rows from EIA API (including any that failed to parse). */
  fetchedCount: number;
  /** Rows that could not be parsed (missing required fields). */
  parseErrors: Array<{ index: number; reason: string; raw?: unknown }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultDataYear(): number {
  // EIA-860 data for year Y is published late in year Y or early Y+1.
  // Use the previous calendar year as the default.
  return new Date().getFullYear() - 1;
}

function buildUrl(
  base: string,
  params: URLSearchParams
): string {
  return `${base}?${params.toString()}`;
}

function buildQueryParams(
  apiKey: string,
  baCode: string | null,
  dataYear: number,
  offset: number
): URLSearchParams {
  const p = new URLSearchParams();
  p.set("api_key", apiKey);
  p.set("frequency", "annual");
  // Request specific data columns
  p.set("data[0]", "nameplate-capacity-mw");
  p.set("data[1]", "summer-capacity-mw");
  p.set("data[2]", "winter-capacity-mw");
  // Sort by plantCode for stable pagination
  p.set("sort[0][column]", "plantCode");
  p.set("sort[0][direction]", "asc");
  p.set("sort[1][column]", "generatorId");
  p.set("sort[1][direction]", "asc");
  // Pagination
  p.set("length", String(EIA_PAGE_SIZE));
  p.set("offset", String(offset));
  // Year filter
  p.set("start", String(dataYear));
  p.set("end", String(dataYear));
  // BA filter (optional)
  if (baCode) {
    p.set("facets[balancingAuthorityCode][]", baCode);
  }
  return p;
}

function rowToInsert(
  raw: EiaRawRow,
  tenantId: string,
  dataYear: number,
  fetchedAt: string
): DbEiaGeneratorInsert | null {
  const plantId = raw.plantCode?.trim();
  const generatorId = raw.generatorId?.trim();
  const plantName = raw.plantName?.trim();

  if (!plantId || !generatorId || !plantName) return null;

  const energySourceCode = raw["energy-source-code"]?.trim() ?? null;

  return {
    tenant_id: tenantId,
    plant_id: plantId,
    generator_id: generatorId,
    plant_name: plantName,
    data_year: dataYear,
    state_abbr: raw.stateid?.trim().toUpperCase() ?? null,
    county: raw.county?.trim() ?? null,
    latitude: parseNullableFloat(raw.latitude),
    longitude: parseNullableFloat(raw.longitude),
    balancing_authority: raw.balancingAuthorityCode?.trim().toUpperCase() ?? null,
    nameplate_mw: parseCapacityMw(raw["nameplate-capacity-mw"]),
    summer_mw: parseCapacityMw(raw["summer-capacity-mw"]),
    winter_mw: parseCapacityMw(raw["winter-capacity-mw"]),
    fuel_type: mapFuelType(energySourceCode, raw.technology),
    prime_mover: raw.primeMoverCode?.trim() ?? null,
    energy_source_code: energySourceCode,
    technology: raw.technology?.trim() ?? null,
    operational_status: mapGeneratorStatus(raw.statusCode),
    operating_year: parseYear(raw.operatingYear),
    operating_month: parseMonth(raw.operatingMonth),
    retirement_year: parseYear(raw.retirementYear),
    retirement_month: parseMonth(raw.retirementMonth),
    utility_id: raw.entityid?.trim() ?? null,
    utility_name: raw.entityName?.trim() ?? null,
    fetched_at: fetchedAt,
  };
}

async function fetchOnePage(
  httpFetch: typeof globalThis.fetch,
  url: string,
  timeoutMs: number
): Promise<EiaApiEnvelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await httpFetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[eia-generators.fetcher] HTTP ${res.status}: ${body.slice(0, 200)}`
    );
  }

  let envelope: EiaApiEnvelope;
  try {
    envelope = (await res.json()) as EiaApiEnvelope;
  } catch {
    throw new Error(
      `[eia-generators.fetcher] EIA API returned non-JSON response (status ${res.status})`
    );
  }

  if (!Array.isArray(envelope?.response?.data)) {
    throw new Error(
      `[eia-generators.fetcher] Unexpected EIA API response shape`
    );
  }

  return envelope;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all generators for the specified balancing authorities from EIA.
 * Paginates automatically until all records are retrieved.
 *
 * @param httpFetch - Injectable fetch function (use globalThis.fetch in prod)
 * @param tenantId  - Tenant ID to stamp on each insert row
 * @param options   - BA codes, data year, timeout, URL overrides
 */
export async function fetchEiaGenerators(
  httpFetch: typeof globalThis.fetch,
  tenantId: string,
  options: FetchGeneratorsOptions = {}
): Promise<GeneratorFetchResult> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[eia-generators.fetcher] EIA_API_KEY environment variable is not set"
    );
  }

  const {
    baCodes = [],
    dataYear = defaultDataYear(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    url: baseUrl = `${EIA_BASE_URL}${EIA_GENERATOR_PATH}`,
  } = options;

  const fetchedAt = new Date().toISOString();
  const allRows: DbEiaGeneratorInsert[] = [];
  const parseErrors: GeneratorFetchResult["parseErrors"] = [];
  let totalFetched = 0;

  // Fetch for each BA code separately (or once with no BA filter if empty)
  const targets: Array<string | null> = baCodes.length > 0 ? baCodes : [null];

  for (const baCode of targets) {
    let offset = 0;
    let totalForBa: number | undefined;

    do {
      const params = buildQueryParams(
        apiKey,
        baCode,
        dataYear,
        offset
      );
      const pageUrl = buildUrl(baseUrl, params);
      const envelope = await fetchOnePage(httpFetch, pageUrl, timeoutMs);

      const pageRows = envelope.response.data;
      if (totalForBa === undefined) {
        totalForBa = envelope.response.total ?? pageRows.length;
      }

      for (let i = 0; i < pageRows.length; i++) {
        const raw = pageRows[i];
        const insert = rowToInsert(raw, tenantId, dataYear, fetchedAt);

        if (!insert) {
          parseErrors.push({
            index: totalFetched + i,
            reason: `missing plant_id, generator_id, or plant_name`,
            raw,
          });
        } else {
          allRows.push(insert);
        }
      }

      totalFetched += pageRows.length;
      offset += EIA_PAGE_SIZE;
    } while (offset < (totalForBa ?? 0) && totalForBa > EIA_PAGE_SIZE);
  }

  return {
    rows: allRows,
    fetchedCount: totalFetched,
    parseErrors,
  };
}
