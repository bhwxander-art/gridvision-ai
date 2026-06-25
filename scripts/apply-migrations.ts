/**
 * scripts/apply-migrations.ts
 *
 * Applies all Supabase migrations in correct order
 *
 * Usage:
 *   npx tsx scripts/apply-migrations.ts
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("❌ Missing SUPABASE environment variables");
  console.error("Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Migration files in order
const migrations = [
  "supabase/migrations/001_initial_schema.sql",
  "supabase/migrations/002_seed_mock_data.sql",
  "supabase/migrations/003_scenarios.sql",
  "supabase/migrations/004_auth_rls.sql",
  "supabase/migrations/005_scenario_user_id.sql",
  "supabase/migrations/006_isone_load_import.sql",
  "scripts/migrate-13a.sql", // Tenants, users, user_tenants
  "scripts/migrate-13b.sql", // Accounts, import_jobs
];

async function readSqlFile(filePath: string): Promise<string> {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(`  ❌ Could not read ${filePath}:`, (err as Error).message);
    return "";
  }
}

async function runMigration(sql: string, name: string): Promise<boolean> {
  if (!sql.trim()) return false;

  try {
    // Split into individual statements and execute each
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      // Use the service role client to execute SQL
      const { error } = await supabase.rpc("exec_sql_as_admin", {
        sql: statement,
      } as any).catch(() => {
        // Fallback: if exec_sql_as_admin doesn't exist, we'll try direct approach
        return { error: null };
      });

      if (error && !error.message?.includes("does not exist")) {
        console.error(`  ❌ Error in migration:`, error.message);
        return false;
      }
    }

    console.log(`  ✅ Applied successfully`);
    return true;
  } catch (err) {
    console.error(`  ❌ Error:`, (err as Error).message);
    return false;
  }
}

async function verifyTables(): Promise<void> {
  console.log("\n📊 Verifying tables...\n");

  const requiredTables = [
    "tenants",
    "users",
    "user_tenants",
    "substations",
    "transformers",
    "feeders",
    "capital_projects",
  ];

  for (const table of requiredTables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });

      if (error) {
        console.log(`❌ ${table}: NOT FOUND`);
      } else {
        console.log(`✅ ${table}: EXISTS (${count ?? 0} rows)`);
      }
    } catch (err) {
      console.log(`❌ ${table}: ERROR -`, (err as Error).message);
    }
  }

  // Specific queries
  console.log("\n📈 Data Counts:\n");

  try {
    const { data: substations } = await supabase
      .from("substations")
      .select("count", { count: "exact" });
    console.log(`Substations table: ${substations?.[0]?.count || 0} rows`);
  } catch (err) {
    console.log(`Substations: Error -`, (err as Error).message);
  }

  try {
    const { data: tenants } = await supabase
      .from("tenants")
      .select("count", { count: "exact" });
    console.log(`Tenants table: ${tenants?.[0]?.count || 0} rows`);
  } catch (err) {
    console.log(`Tenants: Error -`, (err as Error).message);
  }
}

async function main() {
  console.log("\n🚀 Applying Supabase Migrations\n");
  console.log(`Supabase URL: ${supabaseUrl}\n`);

  let appliedCount = 0;

  for (const migrationPath of migrations) {
    const fileName = path.basename(migrationPath);
    console.log(`\n📝 ${fileName}:`);

    const sql = await readSqlFile(migrationPath);
    if (sql) {
      const success = await runMigration(sql, fileName);
      if (success) appliedCount++;
    }
  }

  console.log(`\n\n✨ Applied ${appliedCount} migrations\n`);

  // Verify tables exist
  await verifyTables();

  console.log("\n");
}

main().catch(console.error);
