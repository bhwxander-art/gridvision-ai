/**
 * PJM DataMiner2 interconnection queue fetcher.
 *
 * Source: PJM DataMiner2 REST API (JSON)
 * URL:    https://dataminer2.pjm.com/feed/gen_int_queue
 * Docs:   https://dataminer2.pjm.com/feed/gen_int_queue/definition
 *
 * PJM publishes the full active + historical interconnection queue via this
 * unauthenticated JSON feed. It returns an array of records under the `items`
 * or root array key depending on the version.
 *
 * Key fields returned by PJM:
 *   QUEUE_NUMBER, NAME, FUELD_TYPE, STATUS, MEGAWATTS,
 *   QUEUE_DATE, IN_SERVICE_DATE, COUNTY, STATE_ABBREV,
 *   TRANSMISSION_OWNER, WITHDRAWL_DATE, NETWORK_UPGRADE_COST,
 *   PROJECT_COST_SHARE
 */

import type { IsoFetcher, FetchResult } from "@/lib/ingestion/queue/types";
import {
  parseIsoDate,
  parseMw,
  parseCostMillions,
  mapProjectType,
  mapQueueStatus,
} from "@/lib/ingestion/queue/normalizer";

const DEFAULT_URL =
  "https://dataminer2.pjm.com/feed/gen_int_queue?fields=QUEUE_NUMBER,NAME,FUELD_TYPE,STATUS,MEGAWATTS,QUEUE_DATE,IN_SERVICE_DATE,COUNTY,STATE_ABBREV,TRANSMISSION_OWNER,WITHDRAWL_DATE,NETWORK_UPGRADE_COST,PROJECT_COST_SHARE&rowCount=10000&startRow=1&sortDir=asc&sortCol=QUEUE_NUMBER";

interface PjmRawRow {
  QUEUE_NUMBER?: string;
  NAME?: string;
  FUELD_TYPE?: string;
  STATUS?: string;
  MEGAWATTS?: string | number;
  QUEUE_DATE?: string;
  IN_SERVICE_DATE?: string;
  COUNTY?: string;
  STATE_ABBREV?: string;
  NETWORK_UPGRADE_COST?: string | number;
  PROJECT_COST_SHARE?: string | number;
  [key: string]: unknown;
}

export const pjmFetcher: IsoFetcher = {
  isoId: "PJM",

  async fetch(httpFetch, tenantId, options = {}): Promise<FetchResult> {
    const url = options.url ?? DEFAULT_URL;
    const timeoutMs = options.timeoutMs ?? 30_000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let rawItems: PjmRawRow[];
    try {
      const response = await httpFetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const json = await response.json();
      // PJM wraps the array in { items: [...] } or returns array directly
      rawItems = Array.isArray(json)
        ? json
        : Array.isArray(json?.items)
        ? json.items
        : [];
    } finally {
      clearTimeout(timer);
    }

    const rows = [];
    const errors = [];

    for (let i = 0; i < rawItems.length; i++) {
      const r = rawItems[i];

      const projectNumber = String(r.QUEUE_NUMBER ?? "").trim();
      if (!projectNumber) {
        errors.push({ rowIndex: i, field: "QUEUE_NUMBER", reason: "missing" });
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

      const capacityMw = parseMw(r.MEGAWATTS);
      if (!capacityMw) {
        errors.push({
          rowIndex: i,
          field: "MEGAWATTS",
          reason: "non-positive capacity",
          rawValue: r.MEGAWATTS,
        });
        continue;
      }

      rows.push({
        tenant_id: tenantId,
        iso_id: "PJM",
        project_number: projectNumber,
        project_name: String(r.NAME ?? projectNumber).trim(),
        developer: null,
        project_type: mapProjectType(String(r.FUELD_TYPE ?? "")),
        poi_bus_id: null,
        poi_description: null,
        county: String(r.COUNTY ?? "").trim() || null,
        state_abbr: String(r.STATE_ABBREV ?? "").trim() || null,
        capacity_mw: capacityMw,
        in_service_mw: null,
        queue_date: queueDate,
        study_start_date: null,
        target_cod: parseIsoDate(String(r.IN_SERVICE_DATE ?? "")),
        actual_cod: null,
        current_status: mapQueueStatus(String(r.STATUS ?? "")),
        network_upgrade_cost_m: parseCostMillions(r.NETWORK_UPGRADE_COST),
        project_cost_share_m: parseCostMillions(r.PROJECT_COST_SHARE),
        withdrawal_probability: null,
        ife_last_run_at: null,
        metadata: {
          transmission_owner: String(r.TRANSMISSION_OWNER ?? "").trim() || null,
          raw_status: String(r.STATUS ?? ""),
          raw_fuel_type: String(r.FUELD_TYPE ?? ""),
        },
      });
    }

    return { rows, errors };
  },
};
