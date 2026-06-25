import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing env vars. Set:");
  console.error("  NEXT_PUBLIC_SUPABASE_URL");
  console.error("  SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

console.log("Testing Supabase direct query...\n");

const client = createClient(url, key);

try {
  console.log("Query 1: SELECT * FROM substations (no filter)");
  const { data: all, error: errAll } = await client
    .from("substations")
    .select("*");

  if (errAll) {
    console.error("❌ ERROR:", errAll.message);
  } else {
    console.log(`✅ Result: ${all?.length ?? 0} rows`);
    if (all && all.length > 0) {
      console.log("First row:", JSON.stringify(all[0], null, 2));
    }
  }

  console.log("\n---\n");
  console.log("Query 2: SELECT * FROM substations WITH tenant_id filter");
  const { data: filtered, error: errFiltered } = await client
    .from("substations")
    .select("*")
    .eq("tenant_id", "00000000-0000-0000-0000-000000000000");

  if (errFiltered) {
    console.error("❌ ERROR:", errFiltered.message);
  } else {
    console.log(`✅ Result: ${filtered?.length ?? 0} rows`);
  }

  console.log("\n---\n");
  console.log("Query 3: Column check - what columns exist?");
  const { data: schema, error: errSchema } = await client
    .from("information_schema.columns")
    .select("table_name, column_name")
    .eq("table_name", "substations");

  if (errSchema) {
    console.error("❌ ERROR:", errSchema.message);
  } else {
    console.log(`Columns in substations table:`);
    schema?.forEach(col => console.log(`  - ${col.column_name}`));
  }

} catch (e) {
  console.error("Exception:", e);
}
