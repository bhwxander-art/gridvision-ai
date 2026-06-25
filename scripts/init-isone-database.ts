#!/usr/bin/env node
/**
 * Initialize ISO-NE load data in Supabase
 * 
 * Creates the iso_load_history table and seeds with realistic data
 * 
 * Usage:
 *   npx tsx scripts/init-isone-database.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as fs from "fs";

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

// Generate 7 days of realistic ISO-NE load data
function generateLoadData() {
  const records: Array<{
    timestamp: string;
    actual_load_mw: number;
    forecast_load_mw: number;
  }> = [];

  const baseLoad = 15000; // MW - typical New England base load
  const now = new Date();

  for (let d = 7; d >= 0; d--) {
    for (let h = 0; h < 24; h++) {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      date.setHours(h, 0, 0, 0);

      // Realistic load pattern
      let factor = 0.8; // Night base
      if (h >= 6 && h < 10) factor = 0.85 + (h - 6) * 0.08; // Morning ramp
      else if (h >= 10 && h < 20) factor = 1.4 - (h - 10) * 0.02; // Peak
      else if (h >= 20) factor = 0.85 - (h - 20) * 0.02; // Evening decline

      // Weekend adjustment
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      factor *= isWeekend ? 0.95 : 1.0;

      // Daily variation
      factor *= 0.98 + Math.random() * 0.04;

      const actualLoad = Math.round(baseLoad * factor);
      const forecastLoad = Math.round(actualLoad * (0.98 + Math.random() * 0.04));

      records.push({
        timestamp: date.toISOString(),
        actual_load_mw: actualLoad,
        forecast_load_mw: forecastLoad,
      });
    }
  }

  return records;
}

async function main() {
  console.log("\n📊 ISO-NE Load Database Initialization");
  console.log("═".repeat(60));

  // Create table
  console.log("\n1️⃣  Creating iso_load_history table...");
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS iso_load_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      timestamp TIMESTAMPTZ NOT NULL UNIQUE,
      actual_load_mw NUMERIC NOT NULL,
      forecast_load_mw NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_iso_load_timestamp
      ON iso_load_history(timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_iso_load_created
      ON iso_load_history(created_at DESC);

    ALTER TABLE iso_load_history ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "service_role_all" ON iso_load_history;
    CREATE POLICY "service_role_all"
      ON iso_load_history
      AS PERMISSIVE
      FOR ALL
      TO "service_role"
      USING (true)
      WITH CHECK (true);

    DROP POLICY IF EXISTS "authenticated_read" ON iso_load_history;
    CREATE POLICY "authenticated_read"
      ON iso_load_history
      AS PERMISSIVE
      FOR SELECT
      TO authenticated
      USING (true);
  `;

  const { error: createError } = await supabase.rpc("exec_sql_as_admin", {
    sql: createTableSQL,
  });

  if (createError) {
    console.log("⚠️  Table creation note:", createError.message);
  } else {
    console.log("✅ Table created successfully");
  }

  // Generate and insert data
  console.log("\n2️⃣  Generating 8 days of load data...");
  const records = generateLoadData();
  console.log(`✅ Generated ${records.length} records`);

  console.log("\n3️⃣  Upserting into database...");
  const { error: upsertError, count } = await supabase
    .from("iso_load_history")
    .upsert(records, { onConflict: "timestamp" })
    .select();

  if (upsertError) {
    console.error("❌ Upsert failed:", upsertError.message);
    process.exit(1);
  }

  console.log(`✅ Upserted ${records.length} records`);

  // Verify
  console.log("\n4️⃣  Verifying data...");
  const { data: samples, error: sampleError } = await supabase
    .from("iso_load_history")
    .select("timestamp, actual_load_mw, forecast_load_mw")
    .order("timestamp", { ascending: false })
    .limit(3);

  if (!sampleError && samples) {
    console.log("✅ Recent samples:");
    samples.forEach((s: any) => {
      const ts = new Date(s.timestamp).toLocaleString();
      console.log(
        `   ${ts} — Actual: ${s.actual_load_mw} MW, Forecast: ${s.forecast_load_mw} MW`
      );
    });
  }

  // Final status
  const { count: totalCount } = await supabase
    .from("iso_load_history")
    .select("*", { count: "exact", head: true });

  console.log(`\n✅ Database ready with ${totalCount} load records`);
  console.log(`   API endpoints ready:`);
  console.log(`   • GET /api/load/current`);
  console.log(`   • GET /api/load/history`);
  console.log("\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
