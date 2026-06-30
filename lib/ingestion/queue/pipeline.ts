/**
 * Queue ingestion pipeline orchestrator (INFRA-005).
 *
 * For each ISO:
 *   1. Fetch raw data via the ISO-specific fetcher
 *   2. Validate each row via QueueRepository.validateQueueProjectInsert
 *   3. Upsert in batches of BATCH_SIZE via QueueRepository.upsertProject
 *   4. Collect per-ISO statistics into a PipelineReport
 *
 * The pipeline is fault-isolated at the ISO level: a failure in one ISO
 * does not abort the others. All errors are surfaced in the report.
 *
 * Usage (from cron route):
 *   import { runQueueIngestionPipeline, DEFAULT_FETCHERS } from "@/lib/ingestion/queue/pipeline";
 *   const report = await runQueueIngestionPipeline({ tenantId, fetchers: DEFAULT_FETCHERS, db });
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IsoFetcher, IsoPipelineResult, PipelineReport } from "./types";
import { validateQueueProjectInsert } from "@/lib/db/repositories/queue.repository";
import { pjmFetcher   } from "./fetchers/pjm";
import { caisoFetcher } from "./fetchers/caiso";
import { ercotFetcher } from "./fetchers/ercot";
import { misoFetcher  } from "./fetchers/miso";
import { nyisoFetcher } from "./fetchers/nyiso";
import { isoneFetcher } from "./fetchers/isone";

export const DEFAULT_FETCHERS: IsoFetcher[] = [
  pjmFetcher,
  caisoFetcher,
  ercotFetcher,
  misoFetcher,
  nyisoFetcher,
  isoneFetcher,
];

const BATCH_SIZE = 200;

// Exponential backoff retry for transient ISO API failures.
// ISO public APIs are unreliable; a single transient failure should not
// produce a permanent data gap.
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelayMs * 2 ** attempt)
        );
      }
    }
  }
  throw lastErr;
}

export interface PipelineOptions {
  tenantId: string;
  fetchers?: IsoFetcher[];
  httpFetch?: typeof globalThis.fetch;
  db: SupabaseClient;
  fetchTimeoutMs?: number;
  /** Base delay between retry attempts in ms. Defaults to 1000. Pass 0 in tests. */
  retryBaseDelayMs?: number;
}

async function upsertBatch(
  db: SupabaseClient,
  rows: Parameters<typeof validateQueueProjectInsert>[0][]
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await db
    .from("queue_projects")
    .upsert(rows, {
      onConflict: "tenant_id,iso_id,project_number",
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error(`[pipeline.upsertBatch] ${error.message}`);
  }
  return rows.length;
}

async function runIso(
  fetcher: IsoFetcher,
  options: PipelineOptions
): Promise<IsoPipelineResult> {
  const {
    tenantId,
    httpFetch = globalThis.fetch,
    db,
    fetchTimeoutMs,
    retryBaseDelayMs = 1_000,
  } = options;
  const t0 = Date.now();

  let fetchedCount = 0;
  let normalizedCount = 0;
  let upsertedCount = 0;
  let parseErrors = 0;
  let fetchError: string | undefined;

  try {
    const result = await withRetry(
      () => fetcher.fetch(httpFetch, tenantId, { timeoutMs: fetchTimeoutMs }),
      3,
      retryBaseDelayMs
    );

    fetchedCount = result.rows.length + result.errors.length;
    parseErrors += result.errors.length;

    // Validate and collect valid rows for upserting
    const validRows = [];
    for (const row of result.rows) {
      try {
        validateQueueProjectInsert(row);
        validRows.push(row);
      } catch (err) {
        parseErrors++;
        // Log but don't abort
        console.warn(
          `[queue-ingest][${fetcher.isoId}] validation error for project ${row.project_number}: ${(err as Error).message}`
        );
      }
    }

    normalizedCount = validRows.length;

    // Batch upsert
    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const batch = validRows.slice(i, i + BATCH_SIZE);
      upsertedCount += await upsertBatch(db, batch);
    }
  } catch (err) {
    fetchError = (err as Error).message;
    console.error(
      `[queue-ingest][${fetcher.isoId}] pipeline error: ${fetchError}`
    );
  }

  return {
    isoId: fetcher.isoId,
    fetched: fetchedCount,
    normalized: normalizedCount,
    upserted: upsertedCount,
    parseErrors,
    fetchError,
    durationMs: Date.now() - t0,
  };
}

export async function runQueueIngestionPipeline(
  options: PipelineOptions
): Promise<PipelineReport> {
  const fetchers = options.fetchers ?? DEFAULT_FETCHERS;
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  // Run ISOs in parallel — each is independently fault-isolated
  const isoResults = await Promise.all(
    fetchers.map((fetcher) => runIso(fetcher, options))
  );

  const completedAt = new Date().toISOString();

  const total = isoResults.reduce(
    (acc, r) => ({
      fetched:    acc.fetched    + r.fetched,
      normalized: acc.normalized + r.normalized,
      upserted:   acc.upserted   + r.upserted,
      errors:     acc.errors     + r.parseErrors + (r.fetchError ? 1 : 0),
    }),
    { fetched: 0, normalized: 0, upserted: 0, errors: 0 }
  );

  return {
    runId,
    tenantId: options.tenantId,
    startedAt,
    completedAt,
    isos: isoResults,
    total,
  };
}
