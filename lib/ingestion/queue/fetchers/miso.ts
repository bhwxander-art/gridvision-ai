/**
 * MISO interconnection queue fetcher.
 *
 * Source: MISO Generator Interconnection Queue Report (CSV)
 * URL:    https://api.misoenergy.org/MISORTWD/lmpcontourmap/resources/queuestatus
 *         (falls back to CSV download of the published queue report)
 *
 * MISO covers the Midwest and parts of the South (17 states).
 * Their public queue CSV export uses these columns:
 *   Queue Number, Company Name, Type, MW-AC, MW-DC, County, State, Zone,
 *   Proposed In-Service, Status, Substation Name, Upgrade Cost ($M),
 *   Cost Share ($M), Queue Date, Study Phase
 */

import { parseCsv } from "@/lib/ingestion/queue/csv";
import type { IsoFetcher, FetchResult } from "@/lib/ingestion/queue/types";
import {
  parseIsoDate,
  parseMw,
  parseCostMillions,
  mapProjectType,
  mapQueueStatus,
} from "@/lib/ingestion/queue/normalizer";

const DEFAULT_URL =
  "https://api.misoenergy.org/MISORTWD/lmpcontourmap/resources/queuestatus";

interface MisoJsonProject {
  QUEUE_NBR?: string;
  COMPANY_NAME?: string;
  FUEL_TYPE?: string;
  MW?: string | number;
  COUNTY?: string;
  STATE?: string;
  PROPOSED_IN_SVC_DATE?: string;
  STATUS?: string;
  SUBSTATION?: string;
  QUEUE_DATE?: string;
  NETWORK_UPGRADE_COST?: string | number;
  [key: string]: unknown;
}

async function fetchMisoJson(
  httpFetch: typeof globalThis.fetch,
  url: string,
  controller: AbortController
): Promise<{ rows: MisoJsonProject[] | null; csvText: string | null }> {
  const response = await httpFetch(url, {
    signal: controller.signal,
    headers: { Accept: "application/json, text/csv, */*" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const json = await response.json();
    const items: MisoJsonProject[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.items)
      ? json.items
      : Array.isArray(json?.data)
      ? json.data
      : [];
    return { rows: items, csvText: null };
  }

  // Fallback: treat as CSV
  return { rows: null, csvText: await response.text() };
}

export const misoFetcher: IsoFetcher = {
  isoId: "MISO",

  async fetch(httpFetch, tenantId, options = {}): Promise<FetchResult> {
    const url = options.url ?? DEFAULT_URL;
    const timeoutMs = options.timeoutMs ?? 60_000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let jsonRows: MisoJsonProject[] | null = null;
    let csvText: string | null = null;

    try {
      ({ rows: jsonRows, csvText } = await fetchMisoJson(
        httpFetch,
        url,
        controller
      ));
    } finally {
      clearTimeout(timer);
    }

    const rows = [];
    const errors = [];

    if (jsonRows !== null) {
      // JSON path
      for (let i = 0; i < jsonRows.length; i++) {
        const r = jsonRows[i];

        const queueNumber = String(r.QUEUE_NBR ?? "").trim();
        if (!queueNumber) {
          errors.push({
            rowIndex: i,
            field: "QUEUE_NBR",
            reason: "missing",
          });
          continue;
        }

        const queueDate = parseIsoDate(String(r.QUEUE_DATE ?? ""));
        if (!queueDate) {
          errors.push({
            rowIndex: i,
            field: "QUEUE_DATE",
            reason: "unparseable date",
            rawValue: r.QUEUE_DATE,
          });
          continue;
        }

        const capacityMw = parseMw(r.MW);
        if (!capacityMw) {
          errors.push({
            rowIndex: i,
            field: "MW",
            reason: "non-positive capacity",
            rawValue: r.MW,
          });
          continue;
        }

        rows.push({
          tenant_id: tenantId,
          iso_id: "MISO",
          project_number: queueNumber,
          project_name: String(r.COMPANY_NAME ?? queueNumber).trim(),
          developer: String(r.COMPANY_NAME ?? "").trim() || null,
          project_type: mapProjectType(String(r.FUEL_TYPE ?? "")),
          poi_bus_id: null,
          poi_description: String(r.SUBSTATION ?? "").trim() || null,
          county: String(r.COUNTY ?? "").trim() || null,
          state_abbr: String(r.STATE ?? "").trim() || null,
          capacity_mw: capacityMw,
          in_service_mw: null,
          queue_date: queueDate,
          study_start_date: null,
          target_cod: parseIsoDate(String(r.PROPOSED_IN_SVC_DATE ?? "")),
          actual_cod: null,
          current_status: mapQueueStatus(String(r.STATUS ?? "")),
          network_upgrade_cost_m: parseCostMillions(r.NETWORK_UPGRADE_COST),
          project_cost_share_m: null,
          withdrawal_probability: null,
          ife_last_run_at: null,
          metadata: {
            raw_status: String(r.STATUS ?? ""),
            raw_fuel_type: String(r.FUEL_TYPE ?? ""),
          },
        });
      }
    } else if (csvText) {
      // CSV fallback path
      const rawRows = parseCsv(csvText, {
        hasHeader: true,
        skipBlank: true,
      });

      for (let i = 0; i < rawRows.length; i++) {
        const r = rawRows[i];

        const queueNumber = (
          r["Queue Number"] ?? r["Queue #"] ?? r["QUEUE_NBR"] ?? ""
        ).trim();
        if (!queueNumber) {
          errors.push({
            rowIndex: i,
            field: "Queue Number",
            reason: "missing",
          });
          continue;
        }

        const queueDate = parseIsoDate(
          r["Queue Date"] ?? r["QUEUE_DATE"] ?? r["Application Date"] ?? ""
        );
        if (!queueDate) {
          errors.push({
            rowIndex: i,
            field: "Queue Date",
            reason: "unparseable date",
            rawValue: r["Queue Date"],
          });
          continue;
        }

        const capacityMw = parseMw(
          r["MW-AC"] ?? r["MW"] ?? r["Size (MW)"] ?? r["Net MW"] ?? ""
        );
        if (!capacityMw) {
          errors.push({
            rowIndex: i,
            field: "MW-AC",
            reason: "non-positive capacity",
            rawValue: r["MW-AC"],
          });
          continue;
        }

        const rawStatus =
          r["Status"] ?? r["Study Phase"] ?? r["Current Status"] ?? "";

        rows.push({
          tenant_id: tenantId,
          iso_id: "MISO",
          project_number: queueNumber,
          project_name: (
            r["Company Name"] ?? r["Project Name"] ?? queueNumber
          ).trim(),
          developer: (r["Company Name"] ?? "").trim() || null,
          project_type: mapProjectType(
            r["Type"] ?? r["Fuel Type"] ?? r["Technology"] ?? ""
          ),
          poi_bus_id: null,
          poi_description:
            (r["Substation Name"] ?? r["POI"] ?? "").trim() || null,
          county: (r["County"] ?? "").trim() || null,
          state_abbr: (r["State"] ?? "").trim() || null,
          capacity_mw: capacityMw,
          in_service_mw: null,
          queue_date: queueDate,
          study_start_date: null,
          target_cod: parseIsoDate(
            r["Proposed In-Service"] ??
            r["Proposed COD"] ??
            r["Target COD"] ??
            ""
          ),
          actual_cod: null,
          current_status: mapQueueStatus(rawStatus),
          network_upgrade_cost_m: parseCostMillions(
            r["Upgrade Cost ($M)"] ?? r["Network Upgrade Cost"] ?? ""
          ),
          project_cost_share_m: parseCostMillions(
            r["Cost Share ($M)"] ?? r["Project Cost Share"] ?? ""
          ),
          withdrawal_probability: null,
          ife_last_run_at: null,
          metadata: {
            raw_status: rawStatus,
            raw_type: r["Type"] ?? r["Fuel Type"] ?? null,
          },
        });
      }
    }

    return { rows, errors };
  },
};
