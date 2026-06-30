/**
 * ERCOT interconnection queue fetcher.
 *
 * Source: ERCOT Generator Interconnection Status Report (CSV)
 * URL:    https://mis.ercot.com/misapp/servlets/IROADSReport?reportTypeId=15933
 *
 * ERCOT publishes a CSV (via their MIS portal) containing all active and
 * historical Large Generator Interconnection Requests (LGIRs).
 *
 * Key columns:
 *   INR Number, Request Received Date, Company Name, Technology Type,
 *   Estimated IN-Service Date, Status, County Name, State Name,
 *   Net Electrical Output (MW), Study Phase
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
  "https://mis.ercot.com/misapp/servlets/IROADSReport?reportTypeId=15933&reportTitle=Generator+Interconnection+Status&requestedFormat=1";

export const ercotFetcher: IsoFetcher = {
  isoId: "ERCOT",

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

      const inrNumber = (
        r["INR Number"] ?? r["GEN Interconnect Number"] ?? r["Queue Number"] ?? ""
      ).trim();
      if (!inrNumber) {
        errors.push({ rowIndex: i, field: "INR Number", reason: "missing" });
        continue;
      }

      const queueDate = parseIsoDate(
        r["Request Received Date"] ?? r["Queue Date"] ?? r["Date Received"] ?? ""
      );
      if (!queueDate) {
        errors.push({
          rowIndex: i,
          field: "Request Received Date",
          reason: "unparseable date",
          rawValue: r["Request Received Date"],
        });
        continue;
      }

      const capacityMw = parseMw(
        r["Net Electrical Output (MW)"] ??
        r["MW Output"] ??
        r["Requested MW"] ??
        r["Size (MW)"] ??
        ""
      );
      if (!capacityMw) {
        errors.push({
          rowIndex: i,
          field: "Net Electrical Output (MW)",
          reason: "non-positive capacity",
          rawValue: r["Net Electrical Output (MW)"],
        });
        continue;
      }

      const rawStatus = r["Status"] ?? r["Study Phase"] ?? r["Current Status"] ?? "";

      rows.push({
        tenant_id: tenantId,
        iso_id: "ERCOT",
        project_number: inrNumber,
        project_name: (
          r["Project Name"] ?? r["Company Name"] ?? r["Applicant"] ?? inrNumber
        ).trim(),
        developer: (r["Company Name"] ?? r["Developer"] ?? "").trim() || null,
        project_type: mapProjectType(
          r["Technology Type"] ?? r["Fuel Type"] ?? r["Resource Type"] ?? ""
        ),
        poi_bus_id: null,
        poi_description: (
          r["Point of Interconnection"] ?? r["POI Description"] ?? r["Substation"] ?? ""
        ).trim() || null,
        county: (r["County Name"] ?? r["County"] ?? "").trim() || null,
        state_abbr: "TX", // ERCOT is Texas-only
        capacity_mw: capacityMw,
        in_service_mw: null,
        queue_date: queueDate,
        study_start_date: null,
        target_cod: parseIsoDate(
          r["Estimated IN-Service Date"] ??
          r["Proposed Commercial Operation Date"] ??
          r["COD"] ??
          ""
        ),
        actual_cod: parseIsoDate(
          r["Actual In-Service Date"] ?? r["Actual COD"] ?? ""
        ),
        current_status: mapQueueStatus(rawStatus),
        network_upgrade_cost_m: parseCostMillions(
          r["Network Upgrade Cost"] ?? r["Estimated Cost"] ?? ""
        ),
        project_cost_share_m: null,
        withdrawal_probability: null,
        ife_last_run_at: null,
        metadata: {
          raw_status: rawStatus,
          raw_technology: r["Technology Type"] ?? null,
          study_phase: r["Study Phase"] ?? null,
        },
      });
    }

    return { rows, errors };
  },
};
