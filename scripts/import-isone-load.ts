/**
 * scripts/import-isone-load.ts
 *
 * Imports ISO New England Real-Time Five-Minute System Load data
 * into the grid_load_history table.
 *
 * Supported CSV format (ISO-NE rt_fiveminsysload_YYYYMMDD.csv):
 *   Row type "C" — comment/metadata   → skipped
 *   Row type "H" — column headers     → skipped
 *   Row type "D" — data               → imported
 *
 *   Column layout (D rows):
 *     [0] Row type tag  "D"
 *     [1] Date/Time     "MM/DD/YYYY HH:mm:ss"  (Eastern time)
 *     [2] Total Load    MW
 *     [3] Native Load   MW  ← used as load_mw
 *     [4] Asset Related Load MW
 *     [5] Total Load With Estimated Solar MW
 *     [6] Native Load With Estimated Solar MW
 *
 * Usage:
 *   npx tsx scripts/import-isone-load.ts
 *   npx tsx scripts/import-isone-load.ts --file data/systemload.csv
 *   npx tsx scripts/import-isone-load.ts --tz-offset -04:00
 *   npx tsx scripts/import-isone-load.ts --dry-run
 *
 * Flags:
 *   --file <path>         CSV to import (default: data/systemload.csv)
 *   --territory <id>      territory_id (default: eastern-ma)
 *   --tz-offset <offset>  Eastern time offset: -05:00 (EST) or -04:00 (EDT, default)
 *   --dry-run             Parse and preview without writing to DB
 *
 * Env vars required (add to .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ───────────────────────────────────────────────────────────

function loadEnvFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    // file not present — ok
  }
}

const cwd = process.cwd();
loadEnvFile(path.join(cwd, ".env.local"));
loadEnvFile(path.join(cwd, ".env"));

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(flag: string, def: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : def;
}

const CSV_FILE  = getFlag("--file",      path.join(cwd, "data", "systemload.csv"));
const TERRITORY = getFlag("--territory", "eastern-ma");
const TZ_OFFSET = getFlag("--tz-offset", "-04:00");   // EDT default (summer); use -05:00 for EST
const DRY_RUN   = args.includes("--dry-run");

// Fixed values for this report format
const SOURCE    = "isone";
const INTERVAL  = 5 as const;
const RAW_TYPE  = "Real-Time Five-Minute System Load";

// ── Supabase client ───────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY_RUN && (!supabaseUrl || !supabaseKey)) {
  console.error("");
  console.error("  Missing environment variables:");
  if (!supabaseUrl) console.error("    NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseKey) console.error("    SUPABASE_SERVICE_ROLE_KEY");
  console.error("");
  console.error("  Add them to .env.local, or run with --dry-run to test parsing only.");
  process.exit(1);
}

const db = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedRow {
  recordedAt: string;   // ISO 8601 with timezone, e.g. "2026-06-22T00:00:00-04:00"
  loadMw: number;       // Native Load MW (column 4)
  rawDateTime: string;  // original string from file, e.g. "06/22/2026 00:00:00"
}

// ── Date parsing ──────────────────────────────────────────────────────────────

/**
 * Parses "MM/DD/YYYY HH:mm:ss" into an ISO 8601 string with the given
 * timezone offset, e.g. "2026-06-22T00:00:00-04:00".
 * Does not rely on Date.parse() to avoid locale/format ambiguity.
 */
function parseISONeDate(raw: string, tzOffset: string): string {
  // raw = "06/22/2026 00:00:00"
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Unrecognised date format: "${raw}"`);
  const [, mm, dd, yyyy, hh, min, ss] = match;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}${tzOffset}`;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function stripQuotes(s: string): string {
  s = s.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  return s;
}

/** Splits one CSV line respecting double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
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

// ── CSV parsing ───────────────────────────────────────────────────────────────

async function parseCsv(filePath: string): Promise<ParsedRow[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `CSV file not found: ${filePath}\n` +
      `  Copy your ISO-NE report to data/systemload.csv or pass --file <path>`
    );
  }

  const rows: ParsedRow[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });

  let lineNum = 0;
  let skippedMeta = 0;
  let parseErrors = 0;

  for await (const line of rl) {
    lineNum++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = splitCsvLine(trimmed);
    const rowTag = stripQuotes(parts[0] ?? "").toUpperCase();

    // Skip comment and header rows
    if (rowTag === "C" || rowTag === "H") {
      skippedMeta++;
      continue;
    }

    // Only process data rows
    if (rowTag !== "D") continue;

    // col[1] = Date/Time,  col[3] = Native Load
    const rawDateTime  = parts[1] ? stripQuotes(parts[1]) : "";
    const rawNativeLoad = parts[3] ? stripQuotes(parts[3]) : "";

    if (!rawDateTime || !rawNativeLoad) {
      parseErrors++;
      continue;
    }

    const loadMw = parseFloat(rawNativeLoad);
    if (isNaN(loadMw)) {
      parseErrors++;
      continue;
    }

    let recordedAt: string;
    try {
      recordedAt = parseISONeDate(rawDateTime, TZ_OFFSET);
    } catch {
      parseErrors++;
      continue;
    }

    rows.push({ recordedAt, loadMw, rawDateTime });
  }

  console.log(`  Lines read:        ${lineNum}`);
  console.log(`  Metadata skipped:  ${skippedMeta}  (C/H rows)`);
  if (parseErrors > 0) {
    console.warn(`  Parse errors:      ${parseErrors}  (skipped)`);
  }

  return rows;
}

// ── Batch insert ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;

async function insertBatch(rows: ParsedRow[]): Promise<{ inserted: number; skipped: number }> {
  if (!db) throw new Error("Supabase client not initialised");

  const records = rows.map((r) => ({
    territory_id: TERRITORY,
    recorded_at:  r.recordedAt,
    load_mw:      r.loadMw,
    source:       SOURCE,
    interval_min: INTERVAL,
    raw_type:     RAW_TYPE,
  }));

  const { data, error } = await db
    .from("grid_load_history")
    .upsert(records, {
      onConflict: "territory_id,source,interval_min,recorded_at",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) throw new Error(`Supabase error: ${error.message}`);

  const inserted = data?.length ?? 0;
  return { inserted, skipped: rows.length - inserted };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\nISO-NE Five-Minute Load Import");
  console.log("──────────────────────────────────────────");
  console.log(`  File:        ${CSV_FILE}`);
  console.log(`  Territory:   ${TERRITORY}`);
  console.log(`  Source:      ${SOURCE}`);
  console.log(`  Interval:    ${INTERVAL} min`);
  console.log(`  TZ offset:   ${TZ_OFFSET}`);
  console.log(`  Dry run:     ${DRY_RUN ? "YES — no data will be written" : "no"}`);
  console.log("");

  // ── Parse ──
  console.log("Parsing CSV...");
  const rows = await parseCsv(CSV_FILE);
  console.log(`  Data rows parsed:  ${rows.length}`);

  if (rows.length === 0) {
    console.log("\nNo data rows found. Check the file format.");
    return;
  }

  // ── Sample row preview ──
  const sample = rows[0];
  console.log("");
  console.log("Sample parsed row (first D row):");
  console.log("──────────────────────────────────────────");
  console.log(`  raw Date/Time:  "${sample.rawDateTime}"`);
  console.log(`  recorded_at:    "${sample.recordedAt}"`);
  console.log(`  load_mw:        ${sample.loadMw}`);
  console.log(`  source:         "${SOURCE}"`);
  console.log(`  territory_id:   "${TERRITORY}"`);
  console.log(`  interval_min:   ${INTERVAL}`);
  console.log(`  raw_type:       "${RAW_TYPE}"`);
  console.log("");

  // ── Date range ──
  const timestamps = rows.map((r) => new Date(r.recordedAt).getTime());
  const minTs = new Date(Math.min(...timestamps)).toISOString();
  const maxTs = new Date(Math.max(...timestamps)).toISOString();
  console.log(`  Date range:     ${minTs.slice(0, 16)}Z → ${maxTs.slice(0, 16)}Z`);
  console.log("");

  if (DRY_RUN) {
    console.log("Dry run complete — no rows written.");
    return;
  }

  // ── Batch insert ──
  let totalInserted = 0;
  let totalSkipped  = 0;
  let batchCount    = 0;
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    batchCount++;
    const pct = Math.round((i / rows.length) * 100);
    process.stdout.write(`\rImporting...  ${pct}%  (batch ${batchCount}/${totalBatches})  `);

    const { inserted, skipped } = await insertBatch(batch);
    totalInserted += inserted;
    totalSkipped  += skipped;
  }

  process.stdout.write(`\rImporting...  100%  (${totalBatches}/${totalBatches} batches)   \n`);
  console.log("");
  console.log("Results");
  console.log("──────────────────────────────────────────");
  console.log(`  Inserted:  ${totalInserted}`);
  console.log(`  Skipped:   ${totalSkipped}  (duplicates already in DB)`);
  console.log(`  Processed: ${rows.length}`);
  console.log("");
  console.log("Done. The /api/load/current and /api/load/history endpoints");
  console.log("will now serve real ISO-NE data from the database.");
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
