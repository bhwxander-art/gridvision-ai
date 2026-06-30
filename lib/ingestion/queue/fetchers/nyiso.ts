/**
 * NYISO interconnection queue fetcher.
 *
 * Source: NYISO Interconnection Queue (CSV)
 * URL:    http://www.nyiso.com/public/webdocs/markets_operations/market_data/
 *         interconnections/Comprehensive_Study_Report.csv
 *
 * NYISO covers New York State, divided into 11 load zones (A–K).
 *
 * Key columns:
 *   Queue #, Project Name, Owner, Type, MWac, MWdc, Zone, County, State,
 *   Proposed In-Service Date, Status, Interconnection Point, Cost ($)
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
  "http://www.nyiso.com/public/webdocs/markets_operations/market_data/interconnections/Comprehensive_Study_Report.csv";

export const nyisoFetcher: IsoFetcher = {
  isoId: "NYISO",

  async fetch(httpFetch, tenantId, options = {}): Promise<FetchResult> {
    const url = options.url ?? DEFAULT_URL;
    const timeoutMs = options.timeoutMs ?? 30_000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let csvText: string;
    try {
      const response = await httpFetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      csvText = await response.text();
    } finally {
      clearTimeout(timer);
    }

    const rawRows = parseCsv(csvText, { hasHeader: true, skipBlank: true });

    const rows = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];

      const queueNumber = (
        r["Queue #"] ??
        r["Queue Number"] ??
        r["NYISO Queue Number"] ??
        ""
      ).trim();
      if (!queueNumber) {
        errors.push({ rowIndex: i, field: "Queue #", reason: "missing" });
        continue;
      }

      const queueDate = parseIsoDate(
        r["Application Date"] ??
        r["Date of Application"] ??
        r["Queue Date"] ??
        r["Receipt Date"] ??
        ""
      );
      if (!queueDate) {
        errors.push({
          rowIndex: i,
          field: "Application Date",
          reason: "unparseable date",
          rawValue: r["Application Date"],
        });
        continue;
      }

      const capacityMw = parseMw(
        r["MWac"] ?? r["MW-AC"] ?? r["MW"] ?? r["Size (MW)"] ?? ""
      );
      if (!capacityMw) {
        errors.push({
          rowIndex: i,
          field: "MWac",
          reason: "non-positive capacity",
          rawValue: r["MWac"],
        });
        continue;
      }

      const rawStatus =
        r["Status"] ??
        r["Current Status"] ??
        r["Cluster Status"] ??
        r["Study Status"] ??
        "";

      const poiDescription = (
        r["Interconnection Point"] ??
        r["POI"] ??
        r["Substation"] ??
        ""
      ).trim() || null;

      const zone = (r["Zone"] ?? r["Load Zone"] ?? "").trim() || null;

      rows.push({
        tenant_id: tenantId,
        iso_id: "NYISO",
        project_number: queueNumber,
        project_name: (
          r["Project Name"] ?? r["Name"] ?? r["Project"] ?? queueNumber
        ).trim(),
        developer: (r["Owner"] ?? r["Developer"] ?? r["Applicant"] ?? "").trim() || null,
        project_type: mapProjectType(
          r["Type"] ?? r["Fuel Type"] ?? r["Technology"] ?? ""
        ),
        poi_bus_id: null,
        poi_description: poiDescription,
        county: (r["County"] ?? "").trim() || null,
        state_abbr: (r["State"] ?? "NY").trim() || null,
        capacity_mw: capacityMw,
        in_service_mw: null,
        queue_date: queueDate,
        study_start_date: null,
        target_cod: parseIsoDate(
          r["Proposed In-Service Date"] ??
          r["Proposed Commercial Operation Date"] ??
          r["Target COD"] ??
          ""
        ),
        actual_cod: parseIsoDate(
          r["Actual In-Service Date"] ?? r["Actual COD"] ?? ""
        ),
        current_status: mapQueueStatus(rawStatus),
        network_upgrade_cost_m: parseCostMillions(
          r["Cost ($)"] ??
          r["Estimated Cost"] ??
          r["Network Upgrade Cost"] ??
          ""
        ),
        project_cost_share_m: null,
        withdrawal_probability: null,
        ife_last_run_at: null,
        metadata: {
          raw_status: rawStatus,
          raw_type: r["Type"] ?? r["Technology"] ?? null,
          zone,
        },
      });
    }

    return { rows, errors };
  },
};
