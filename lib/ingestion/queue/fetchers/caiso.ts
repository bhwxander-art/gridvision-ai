/**
 * CAISO interconnection queue fetcher.
 *
 * Source: CAISO Active and Historical Interconnection Queue (CSV)
 * URL:    https://www.caiso.com/Documents/ActiveandHistoricalInterconnectionQueue.csv
 *
 * CAISO publishes a CSV containing all active and historical interconnection
 * requests. The CSV uses a header row on the first line.
 *
 * Key columns:
 *   Queue Position, Application Received Date, Project Name, Technology Type,
 *   Generation Type, MW-AC, MW-DC, Feasibility Study Status,
 *   System Impact Study Status, Interconnection Agreement Status,
 *   First Point of Interconnection (Substation Name), County, State,
 *   Proposed On-line Date, Interconnection Agreement Execution Date
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
  "https://www.caiso.com/Documents/ActiveandHistoricalInterconnectionQueue.csv";

function inferCaisoStatus(row: Record<string, string>): string {
  const ia = row["Interconnection Agreement Status"] ?? "";
  const si = row["System Impact Study Status"] ?? "";
  const fs = row["Feasibility Study Status"] ?? "";

  if (/executed|signed/i.test(ia)) return "Executed IA";
  if (/complete/i.test(si)) return "Phase 2";
  if (/complete/i.test(fs)) return "Phase 1";
  if (/withdrawn|cancel/i.test(row["Current Development Phase"] ?? "")) return "Withdrawn";
  if (/in[\s-]service|operational/i.test(row["Interconnection Agreement Status"] ?? "")) return "In Service";
  return "Active";
}

export const caisoFetcher: IsoFetcher = {
  isoId: "CAISO",

  async fetch(httpFetch, tenantId, options = {}): Promise<FetchResult> {
    const url = options.url ?? DEFAULT_URL;
    const timeoutMs = options.timeoutMs ?? 60_000; // CAISO file is large

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

    // CAISO CSV sometimes has a title row before the header — skip lines
    // that don't look like data until we find a line with "Queue Position".
    const lines = csvText.split(/\r?\n/);
    const headerLineIdx = lines.findIndex((l) =>
      /queue\s*position|application\s*received/i.test(l)
    );
    const cleanCsv =
      headerLineIdx >= 0 ? lines.slice(headerLineIdx).join("\n") : csvText;

    const rawRows = parseCsv(cleanCsv, { hasHeader: true, skipBlank: true });

    const rows = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];

      const queuePos = (
        r["Queue Position"] ?? r["Queue #"] ?? r["Position"] ?? ""
      ).trim();
      if (!queuePos) {
        errors.push({ rowIndex: i, field: "Queue Position", reason: "missing" });
        continue;
      }

      const queueDate = parseIsoDate(
        r["Application Received Date"] ?? r["Queue Date"] ?? ""
      );
      if (!queueDate) {
        errors.push({
          rowIndex: i,
          field: "Application Received Date",
          reason: "unparseable date",
          rawValue: r["Application Received Date"],
        });
        continue;
      }

      const capacityMw = parseMw(r["MW-AC"] ?? r["MW"] ?? r["Size (MW)"] ?? "");
      if (!capacityMw) {
        errors.push({
          rowIndex: i,
          field: "MW-AC",
          reason: "non-positive capacity",
          rawValue: r["MW-AC"],
        });
        continue;
      }

      const statusRaw = inferCaisoStatus(r);

      rows.push({
        tenant_id: tenantId,
        iso_id: "CAISO",
        project_number: queuePos,
        project_name: (
          r["Project Name"] ??
          r["Name"] ??
          r["Company/Project Name"] ??
          queuePos
        ).trim(),
        developer: (r["Owner"] ?? r["Applicant"] ?? "").trim() || null,
        project_type: mapProjectType(
          r["Technology Type"] ?? r["Generation Type"] ?? r["Fuel Type"] ?? ""
        ),
        poi_bus_id: null,
        poi_description: (
          r["First Point of Interconnection (Substation Name)"] ??
          r["Substation Name"] ??
          ""
        ).trim() || null,
        county: (r["County"] ?? "").trim() || null,
        state_abbr: (r["State"] ?? "CA").trim() || null,
        capacity_mw: capacityMw,
        in_service_mw: null,
        queue_date: queueDate,
        study_start_date: null,
        target_cod: parseIsoDate(
          r["Proposed On-line Date"] ??
          r["Proposed On Line Date"] ??
          r["Proposed Commercial Operation Date"] ??
          ""
        ),
        actual_cod: parseIsoDate(
          r["Actual On-line Date"] ?? r["Actual Commercial Operation Date"] ?? ""
        ),
        current_status: mapQueueStatus(statusRaw),
        network_upgrade_cost_m: parseCostMillions(
          r["Estimated Network Upgrade Cost"] ?? r["Network Upgrade Cost"] ?? ""
        ),
        project_cost_share_m: null,
        withdrawal_probability: null,
        ife_last_run_at: null,
        metadata: {
          raw_status: statusRaw,
          raw_technology: r["Technology Type"] ?? r["Generation Type"] ?? null,
          ia_status: r["Interconnection Agreement Status"] ?? null,
        },
      });
    }

    return { rows, errors };
  },
};
