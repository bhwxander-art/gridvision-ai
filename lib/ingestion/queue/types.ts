/**
 * Shared types for the ISO queue ingestion pipeline (INFRA-005).
 */

import type { DbQueueProjectInsert } from "@/lib/db/types-queue";

export type IsoId = "PJM" | "CAISO" | "ERCOT" | "MISO" | "NYISO" | "ISONE";

export const ALL_ISO_IDS: IsoId[] = [
  "PJM",
  "CAISO",
  "ERCOT",
  "MISO",
  "NYISO",
  "ISONE",
];

export interface ParseError {
  rowIndex: number;
  field: string;
  reason: string;
  rawValue?: unknown;
}

export interface FetchResult {
  rows: DbQueueProjectInsert[];
  errors: ParseError[];
}

/**
 * Contract every ISO fetcher must implement.
 *
 * @param httpFetch - injectable fetch function (use globalThis.fetch in production,
 *                   inject a stub in tests)
 * @param tenantId  - the tenant that will own these records
 * @param options   - optional overrides for the data source URL and timeout
 */
export interface IsoFetcher {
  readonly isoId: IsoId;
  fetch(
    httpFetch: typeof globalThis.fetch,
    tenantId: string,
    options?: { url?: string; timeoutMs?: number }
  ): Promise<FetchResult>;
}

export interface IsoPipelineResult {
  isoId: IsoId;
  fetched: number;
  normalized: number;
  upserted: number;
  parseErrors: number;
  fetchError?: string;
  durationMs: number;
}

export interface PipelineReport {
  runId: string;
  tenantId: string;
  startedAt: string;
  completedAt: string;
  isos: IsoPipelineResult[];
  total: {
    fetched: number;
    normalized: number;
    upserted: number;
    errors: number;
  };
}
