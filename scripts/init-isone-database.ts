#!/usr/bin/env node
/**
 * Import real ISO-NE load data into Supabase
 *
 * Downloads official ISO-NE Real-Time Five-Minute System Load data
 * from https://www.iso-ne.com/isoexpress/ and imports into iso_load_history
 *
 * Official Data Source:
 *   https://www.iso-ne.com/isoexpress/
 *   File: rt_fiveminsysload_YYYYMMDD.csv (5-minute interval data)
 *
 * Usage:
 *   npx tsx scripts/init-isone-database.ts              # Last 3 days
 *   npx tsx scripts/init-isone-database.ts --date 2026-06-25
 *   npx tsx scripts/init-isone-database.ts --days 7
 *   npx tsx scripts/init-isone-database.ts --dry-run
 */

import { createClient } from "@supabase/supabase-js";

// ── Supabase Setup ─────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Error: Missing Supabase environment variables");
  console.error("   NEXT_PUBLIC_SUPABASE_URL");
  console.error("   SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── ISO-NE Official Data Source ────────────────────────────────────────────

const ISO_NE_BASE = "https://www.iso-ne.com/static-assets/documents";
const TZ_OFFSET = "-04:00"; // EDT (summer); use -05:00 for EST

/**
 * Formats a date as YYYYMMDD for ISO-NE CSV filename
 */
function formatDateForFilename(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * Constructs ISO-NE isoexpress CSV download URL for a given date
 */
function getIsoNeUrl(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dateStr = formatDateForFilename(date);
  return `${ISO_NE_BASE}/${yyyy}/${mm}/rt_fiveminsysload_${dateStr}.csv`;
}

/**
 * Converts "MM/DD/YYYY HH:mm:ss" to ISO 8601 with timezone offset
 */
function parseIsoNeDate(raw: string, tzOffset: string): string {
  const match = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) throw new Error(`Invalid date format: "${raw}"`);
  const [, mm, dd, yyyy, hh, min, ss] = match;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}${tzOffset}`;
}

/**
 * CSV line splitter respecting quoted fields
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function stripQuotes(s: string): string {
  s = s.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Fetch and parse real ISO-NE CSV data from official source
 */
async function fetchAndParseIsoNeData(date: Date): Promise<
  Array<{
    timestamp: string;
    actual_load_mw: number;
    forecast_load_mw: number;
  }>
> {
  const url = getIsoNeUrl(date);
  console.log(`📥 Downloading from: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const csvText = await response.text();
    const records: Array<{
      timestamp: string;
      actual_load_mw: number;
      forecast_load_mw: number;
    }> = [];

    const lines = csvText.split(/\r?\n/);
    let dataRows = 0;
    let errors = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = splitCsvLine(trimmed);
      const rowTag = stripQuotes(parts[0] ?? "").toUpperCase();

      // Skip comments and headers
      if (rowTag === "C" || rowTag === "H") continue;
      if (rowTag !== "D") continue;

      dataRows++;

      const rawDateTime = parts[1] ? stripQuotes(parts[1]) : "";
      const rawNativeLoad = parts[3] ? stripQuotes(parts[3]) : ""; // Col 3 = Native Load MW

      if (!rawDateTime || !rawNativeLoad) {
        errors++;
        continue;
      }

      const actualLoad = parseFloat(rawNativeLoad);
      if (isNaN(actualLoad)) {
        errors++;
        continue;
      }

      let timestamp: string;
      try {
        timestamp = parseIsoNeDate(rawDateTime, TZ_OFFSET);
      } catch {
        errors++;
        continue;
      }

      // No forecast in official 5-min data — use actual as placeholder
      records.push({
        timestamp,
        actual_load_mw: Math.round(actualLoad),
        forecast_load_mw: Math.round(actualLoad),
      });
    }

    console.log(`   ✅ ${dataRows} data rows, ${errors} parse errors`);
    if (records.length === 0) {
      throw new Error("No valid data rows found in CSV");
    }

    return records;
  } catch (err) {
    throw new Error(
      `Failed to fetch ISO-NE data: ${(err as Error).message}`
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🌐 ISO-NE Real Load Data Import");
  console.log("═".repeat(60));
  console.log(`Official Source: https://www.iso-ne.com/isoexpress/`);
  console.log(`Data Type: Real-Time Five-Minute System Load (native load)`);
  console.log("");

  // Parse command-line flags
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];
  const daysArg = args.find((a) => a.startsWith("--days="))?.split("=")[1];

  const days = daysArg ? parseInt(daysArg, 10) : 3;
  const startDate = dateArg ? new Date(dateArg) : new Date();

  console.log(`Fetching ${days} day(s) of real ISO-NE data`);
  console.log(`${dryRun ? "Mode: DRY-RUN (preview only)" : "Mode: LIVE (write to database)"}`);
  console.log("");

  // Fetch data for multiple days
  let totalRecords = 0;
  const allRecords: Array<{
    timestamp: string;
    actual_load_mw: number;
    forecast_load_mw: number;
  }> = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() - d);

    const dateStr = date.toISOString().split("T")[0];
    console.log(`📅 ${dateStr}`);
    try {
      const records = await fetchAndParseIsoNeData(date);
      allRecords.push(...records);
      totalRecords += records.length;
      console.log(`   → ${records.length} records`);
    } catch (err) {
      console.error(`   ⚠️  ${(err as Error).message}`);
      console.error(`   (ISO-NE may not have published data for this date)`);
      // Don't fail entirely — continue to next day
    }
  }

  if (allRecords.length === 0) {
    console.error("\n❌ FATAL: No data was retrieved from any date");
    console.error("   ISO-NE may not have published data for these dates");
    console.error("   or the files may not yet be available.");
    process.exit(1);
  }

  console.log(`\n✅ Total records fetched: ${totalRecords}`);

  if (dryRun) {
    console.log("\n🔍 DRY-RUN MODE — Preview (first 5 records):");
    allRecords.slice(0, 5).forEach((r) => {
      const ts = new Date(r.timestamp).toLocaleString();
      console.log(`   ${ts} — ${r.actual_load_mw.toLocaleString()} MW`);
    });
    console.log(`\nWould upsert ${totalRecords} records from official ISO-NE source`);
    console.log("Dry run complete — no changes to database\n");
    return;
  }

  // Upsert into database
  console.log("\n💾 Upserting real ISO-NE data into iso_load_history...");
  const { error: upsertError } = await supabase
    .from("iso_load_history")
    .upsert(allRecords, { onConflict: "timestamp" });

  if (upsertError) {
    console.error("❌ Upsert failed:", upsertError.message);
    process.exit(1);
  }

  console.log(`✅ Upserted ${allRecords.length} records`);

  // Verify
  const { data: samples } = await supabase
    .from("iso_load_history")
    .select("timestamp, actual_load_mw")
    .order("timestamp", { ascending: false })
    .limit(5);

  if (samples && samples.length > 0) {
    console.log("\n📊 Latest records from ISO-NE in database:");
    samples.forEach((s: any) => {
      const ts = new Date(s.timestamp).toLocaleString();
      console.log(`   ${ts} — ${s.actual_load_mw.toLocaleString()} MW`);
    });
  }

  const { count: totalCount } = await supabase
    .from("iso_load_history")
    .select("*", { count: "exact", head: true });

  console.log(`\n✅ Database contains ${totalCount} total real ISO-NE records`);
  console.log(`   API ready: GET /api/load/iso-current\n`);
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
