/**
 * ISO-NE interconnection queue fetcher.
 *
 * Source: ISO New England Generator Interconnection Request Queue (CSV)
 * URL:    https://www.iso-ne.com/static-assets/documents/2024/01/
 *         gen-interconnection-request-queue.csv
 *
 * ISO-NE covers the six-state New England region.
 *
 * Key columns:
 *   Capacity Item #, Project Name, Owner, Technology, Summer Capacity (MW),
 *   Proposed Commercial Operation Date, Status, State, Town/City,
 *   First Point of Interconnection, Cost Estimate ($M), Date Submitted
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

// ISO-NE updates this file periodically; the path may change year-to-year.
// Configure ISONE_QUEUE_URL env var to override in production.
const DEFAULT_URL =
  process.env.ISONE_QUEUE_URL ??
  "https://www.iso-ne.com/static-assets/documents/2024/01/gen-interconnection-request-queue.csv";

export const isoneFetcher: IsoFetcher = {
  isoId: "ISONE",

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

    // ISO-NE sometimes prepends metadata lines before the header
    const lines = csvText.split(/\r?\n/);
    const headerIdx = lines.findIndex((l) =>
      /capacity\s*item|project\s*name|date\s*submitted/i.test(l)
    );
    const cleanCsv =
      headerIdx >= 0 ? lines.slice(headerIdx).join("\n") : csvText;

    const rawRows = parseCsv(cleanCsv, { hasHeader: true, skipBlank: true });

    const rows = [];
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];

      const capacityItemNum = (
        r["Capacity Item #"] ??
        r["Queue #"] ??
        r["Project Number"] ??
        r["Queue Number"] ??
        ""
      ).trim();
      if (!capacityItemNum) {
        errors.push({
          rowIndex: i,
          field: "Capacity Item #",
          reason: "missing",
        });
        continue;
      }

      const queueDate = parseIsoDate(
        r["Date Submitted"] ??
        r["Application Date"] ??
        r["Queue Date"] ??
        r["Date Received"] ??
        ""
      );
      if (!queueDate) {
        errors.push({
          rowIndex: i,
          field: "Date Submitted",
          reason: "unparseable date",
          rawValue: r["Date Submitted"],
        });
        continue;
      }

      const capacityMw = parseMw(
        r["Summer Capacity (MW)"] ??
        r["Winter Capacity (MW)"] ??
        r["Capacity (MW)"] ??
        r["MW"] ??
        r["Size (MW)"] ??
        ""
      );
      if (!capacityMw) {
        errors.push({
          rowIndex: i,
          field: "Summer Capacity (MW)",
          reason: "non-positive capacity",
          rawValue: r["Summer Capacity (MW)"],
        });
        continue;
      }

      const rawStatus =
        r["Status"] ?? r["Current Status"] ?? r["Study Status"] ?? "";

      // ISO-NE states: CT, ME, MA, NH, RI, VT (6-state New England)
      const stateAbbr =
        (r["State"] ?? r["State/Province"] ?? "").trim() || null;

      rows.push({
        tenant_id: tenantId,
        iso_id: "ISONE",
        project_number: capacityItemNum,
        project_name: (
          r["Project Name"] ?? r["Name"] ?? capacityItemNum
        ).trim(),
        developer: (r["Owner"] ?? r["Developer"] ?? r["Applicant"] ?? "").trim() || null,
        project_type: mapProjectType(
          r["Technology"] ??
          r["Fuel Type"] ??
          r["Resource Type"] ??
          r["Generation Type"] ??
          ""
        ),
        poi_bus_id: null,
        poi_description: (
          r["First Point of Interconnection"] ??
          r["Interconnection Point"] ??
          r["Substation"] ??
          ""
        ).trim() || null,
        county: null, // ISO-NE reports town, not county
        state_abbr: stateAbbr,
        capacity_mw: capacityMw,
        in_service_mw: null,
        queue_date: queueDate,
        study_start_date: null,
        target_cod: parseIsoDate(
          r["Proposed Commercial Operation Date"] ??
          r["Proposed COD"] ??
          r["Proposed In-Service Date"] ??
          ""
        ),
        actual_cod: parseIsoDate(
          r["Actual Commercial Operation Date"] ?? r["Actual COD"] ?? ""
        ),
        current_status: mapQueueStatus(rawStatus),
        network_upgrade_cost_m: parseCostMillions(
          r["Cost Estimate ($M)"] ??
          r["Estimated Cost"] ??
          r["Network Upgrade Cost"] ??
          ""
        ),
        project_cost_share_m: null,
        withdrawal_probability: null,
        ife_last_run_at: null,
        metadata: {
          raw_status: rawStatus,
          raw_technology: r["Technology"] ?? r["Fuel Type"] ?? null,
          town: (r["Town/City"] ?? r["Town"] ?? "").trim() || null,
          state: stateAbbr,
        },
      });
    }

    return { rows, errors };
  },
};
