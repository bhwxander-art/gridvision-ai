/**
 * POST /api/sync/iso-load
 *
 * Invoked by Vercel Cron every hour. Fetches the latest system load from
 * the active provider and upserts it into iso_load_history.
 *
 * Security: if CRON_SECRET is set, Vercel automatically adds
 *   Authorization: Bearer {CRON_SECRET}
 * to cron invocations. This route verifies the header when the secret is present.
 *
 * Manual trigger (development):
 *   curl -X GET http://localhost:3000/api/sync/iso-load
 */

import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { LoadRepository } from "@/lib/db/repositories/load.repository";
import { getLoadProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STALE_THRESHOLD_MINUTES = 55; // skip sync if data is fresher than this

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 1000
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

export async function GET(request: Request): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── Prerequisites ─────────────────────────────────────────────────────────
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  let provider;
  try {
    provider = getLoadProvider();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 503 }
    );
  }

  const repo = new LoadRepository(getServerClient());

  // ── Freshness check — skip if data is already recent ─────────────────────
  try {
    const current = await repo.getCurrent();
    if (current) {
      const ageMinutes =
        (Date.now() - new Date(current.timestamp).getTime()) / 60_000;
      if (ageMinutes < STALE_THRESHOLD_MINUTES) {
        return NextResponse.json({
          status: "skipped",
          reason: `data is ${Math.round(ageMinutes)}m old (threshold: ${STALE_THRESHOLD_MINUTES}m)`,
          provider: provider.name,
          latest_timestamp: current.timestamp,
        });
      }
    }
  } catch {
    // getCurrent failure is non-fatal — proceed to fetch and upsert
  }

  // ── Fetch from provider ───────────────────────────────────────────────────
  let reading;
  try {
    reading = await withRetry(() => provider.fetchCurrent());
  } catch (err) {
    const message = (err as Error).message;
    console.error("[sync/iso-load] provider fetch failed:", message);
    return NextResponse.json(
      { error: `Provider fetch failed: ${message}`, provider: provider.name },
      { status: 502 }
    );
  }

  // ── Upsert ────────────────────────────────────────────────────────────────
  try {
    await repo.upsert(
      reading.timestamp,
      reading.actualLoadMW,
      reading.actualLoadMW  // forecast: use actual (neither EIA nor ISO-NE 5-min provides hourly forecast)
    );
  } catch (err) {
    const message = (err as Error).message;
    console.error("[sync/iso-load] upsert failed:", message);
    return NextResponse.json(
      { error: `Database upsert failed: ${message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "ok",
    provider: provider.name,
    timestamp: reading.timestamp,
    actual_load_mw: reading.actualLoadMW,
  });
}
