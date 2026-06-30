/**
 * EIA Generator Ingestion Pipeline (INFRA-006)
 *
 * Orchestrates:
 *   1. Fetch operating-generator-capacity data from EIA API
 *   2. Validate each row
 *   3. Upsert in batches via EiaGeneratorRepository
 *   4. Return a structured report
 *
 * Design principles shared with INFRA-005:
 *   - Exponential-backoff retry on transient HTTP failures (3 attempts)
 *   - Idempotent: running twice produces the same DB state
 *   - Multi-tenant: every row is stamped with tenant_id
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchEiaGenerators } from "./fetcher";
import type { FetchGeneratorsOptions } from "./fetcher";
import { EiaGeneratorRepository } from "@/lib/db/repositories/eia-generator.repository";
import { validateEiaGeneratorInsert } from "@/lib/db/types-eia-generators";

// ── Retry helper ──────────────────────────────────────────────────────────────

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

// ── Public types ──────────────────────────────────────────────────────────────

export interface EiaGeneratorPipelineOptions {
  tenantId: string;
  db: SupabaseClient;
  httpFetch?: typeof globalThis.fetch;
  /** Balancing authority codes to fetch. Omit to fetch all US generators. */
  baCodes?: string[];
  /** Override the data year (default: previous calendar year). */
  dataYear?: number;
  /** Timeout for each EIA API page request. Defaults to 30,000 ms. */
  fetchTimeoutMs?: number;
  /** Base delay between retry attempts. Pass 0 in tests. Default: 1,000 ms. */
  retryBaseDelayMs?: number;
  /** Override base URL (for tests). */
  url?: string;
}

export interface EiaGeneratorPipelineReport {
  runId: string;
  tenantId: string;
  dataYear: number;
  startedAt: string;
  completedAt: string;
  fetchedCount: number;
  validatedCount: number;
  upsertedCount: number;
  parseErrors: number;
  validationErrors: number;
  fetchError?: string;
  durationMs: number;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export async function runEiaGeneratorPipeline(
  options: EiaGeneratorPipelineOptions
): Promise<EiaGeneratorPipelineReport> {
  const {
    tenantId,
    db,
    httpFetch = globalThis.fetch,
    baCodes = [],
    dataYear,
    fetchTimeoutMs,
    retryBaseDelayMs = 1_000,
    url,
  } = options;

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const resolvedDataYear = dataYear ?? (new Date().getFullYear() - 1);

  let fetchedCount = 0;
  let validatedCount = 0;
  let upsertedCount = 0;
  let parseErrors = 0;
  let validationErrors = 0;
  let fetchError: string | undefined;

  try {
    // ── Step 1: Fetch from EIA API ──────────────────────────────────────────
    const fetchOptions: FetchGeneratorsOptions = {
      baCodes,
      dataYear: resolvedDataYear,
      timeoutMs: fetchTimeoutMs,
      url,
    };

    const result = await withRetry(
      () => fetchEiaGenerators(httpFetch, tenantId, fetchOptions),
      3,
      retryBaseDelayMs
    );

    fetchedCount = result.fetchedCount;
    parseErrors = result.parseErrors.length;

    if (result.parseErrors.length > 0) {
      console.warn(
        `[eia-generator-ingest] ${result.parseErrors.length} rows skipped due to parse errors`
      );
    }

    // ── Step 2: Validate rows ───────────────────────────────────────────────
    const validRows = [];
    for (const row of result.rows) {
      try {
        validateEiaGeneratorInsert(row);
        validRows.push(row);
      } catch (err) {
        validationErrors++;
        console.warn(
          `[eia-generator-ingest] validation error plant=${row.plant_id} gen=${row.generator_id}: ${(err as Error).message}`
        );
      }
    }
    validatedCount = validRows.length;

    // ── Step 3: Upsert via repository ───────────────────────────────────────
    const repo = new EiaGeneratorRepository(db);
    upsertedCount = await repo.upsertBatch(validRows);
  } catch (err) {
    fetchError = (err as Error).message;
    console.error(`[eia-generator-ingest] pipeline error: ${fetchError}`);
  }

  const completedAt = new Date().toISOString();

  return {
    runId,
    tenantId,
    dataYear: resolvedDataYear,
    startedAt,
    completedAt,
    fetchedCount,
    validatedCount,
    upsertedCount,
    parseErrors,
    validationErrors,
    fetchError,
    durationMs: Date.now() - t0,
  };
}
