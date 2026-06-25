#!/usr/bin/env node
/**
 * Backfill ISO-NE load data from EIA Open Data into Supabase
 *
 * Data source: U.S. Energy Information Administration Form 930 (Hourly)
 * Endpoint:    https://api.eia.gov/v2/electricity/rto/region-data/data/
 * Respondent:  ISNE (ISO New England)
 * License:     U.S. government open data — no commercial restrictions
 *
 * Required env vars:
 *   EIA_API_KEY              — free at https://www.eia.gov/opendata/
 *   NEXT_PUBLIC_SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (bypasses RLS)
 *
 * Usage:
 *   npx tsx scripts/init-isone-database.ts              # Last 7 days
 *   npx tsx scripts/init-isone-database.ts --days 30
 *   npx tsx scripts/init-isone-database.ts --date 2026-06-20
 *   npx tsx scripts/init-isone-database.ts --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import { EIAProvider } from "../lib/providers/eia.provider";

// ── Prerequisites ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase environment variables:");
  if (!SUPABASE_URL) console.error("   NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!SUPABASE_KEY) console.error("   SUPABASE_SERVICE_ROLE_KEY is not set");
  process.exit(1);
}

if (!process.env.EIA_API_KEY) {
  console.error("❌ EIA_API_KEY is not set");
  console.error("   Get a free key at https://www.eia.gov/opendata/");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🌐 EIA → ISO New England Load Data Backfill");
  console.log("═".repeat(60));
  console.log("Source:      EIA Form 930 – Hourly Electric Grid Monitor");
  console.log("Respondent:  ISNE (ISO New England)");
  console.log("Granularity: Hourly (UTC)");
  console.log("");

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1]
    ?? args[args.indexOf("--date") + 1];
  const daysArg = args.find((a) => a.startsWith("--days="))?.split("=")[1]
    ?? (args.includes("--days") ? args[args.indexOf("--days") + 1] : undefined);

  const days = daysArg ? parseInt(daysArg, 10) : 7;
  const startDate = dateArg ? new Date(dateArg + "T00:00:00Z") : new Date();

  console.log(`Period:      Last ${days} day(s) ending ${startDate.toISOString().slice(0, 10)}`);
  console.log(`Mode:        ${dryRun ? "DRY-RUN (no database writes)" : "LIVE (writes to iso_load_history)"}`);
  console.log("");

  const provider = new EIAProvider();
  const allRecords: Array<{
    timestamp: string;
    actual_load_mw: number;
    forecast_load_mw: number;
  }> = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() - d);
    const day = date.toISOString().slice(0, 10);

    process.stdout.write(`📅 ${day}  `);

    try {
      const readings = await provider.fetchDay(date);
      const records = readings.map((r) => ({
        timestamp: r.timestamp,
        actual_load_mw: r.actualLoadMW,
        forecast_load_mw: r.actualLoadMW, // EIA Form 930 does not include forecast
      }));
      allRecords.push(...records);
      console.log(`→ ${records.length} readings`);
    } catch (err) {
      console.log(`→ skipped (${(err as Error).message})`);
    }
  }

  if (allRecords.length === 0) {
    console.error("\n❌ No data retrieved from EIA for any date.");
    console.error("   Check that EIA_API_KEY is valid and that ISNE data is published for these dates.");
    process.exit(1);
  }

  console.log(`\n✅ Total readings fetched: ${allRecords.length}`);

  if (dryRun) {
    console.log("\n🔍 DRY-RUN — first 5 records:");
    allRecords.slice(0, 5).forEach((r) => {
      const ts = new Date(r.timestamp).toISOString();
      console.log(`   ${ts}  ${r.actual_load_mw.toLocaleString()} MW`);
    });
    console.log("\nDry run complete — no database changes.\n");
    return;
  }

  // ── Batch upsert ──────────────────────────────────────────────────────────

  console.log("\n💾 Upserting into iso_load_history…");

  // Supabase upsert in chunks to stay within PostgREST limits
  const CHUNK = 500;
  let upserted = 0;

  for (let i = 0; i < allRecords.length; i += CHUNK) {
    const chunk = allRecords.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("iso_load_history")
      .upsert(chunk, { onConflict: "timestamp" });

    if (error) {
      console.error(`\n❌ Upsert failed at offset ${i}: ${error.message}`);
      process.exit(1);
    }
    upserted += chunk.length;
    process.stdout.write(`\r💾 Upserted ${upserted}/${allRecords.length}…`);
  }
  console.log(`\r✅ Upserted ${upserted} records                         `);

  // ── Verify ────────────────────────────────────────────────────────────────

  const { data: latest } = await supabase
    .from("iso_load_history")
    .select("timestamp, actual_load_mw")
    .order("timestamp", { ascending: false })
    .limit(3);

  if (latest && latest.length > 0) {
    console.log("\n📊 Latest records in database:");
    (latest as Array<{ timestamp: string; actual_load_mw: number }>).forEach((r) => {
      const ts = new Date(r.timestamp).toISOString();
      console.log(`   ${ts}  ${r.actual_load_mw.toLocaleString()} MW`);
    });
  }

  const { count } = await supabase
    .from("iso_load_history")
    .select("*", { count: "exact", head: true });

  console.log(`\n✅ Database total: ${count} records`);
  console.log("   Production API: GET /api/load/iso-current");
  console.log("   Sync cron:      POST /api/sync/iso-load (every hour at :05)\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal:", (err as Error).message);
  process.exit(1);
});
