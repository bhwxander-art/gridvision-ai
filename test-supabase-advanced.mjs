import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const client = createClient(url, key);

console.log("Test 1: Simple select (no relations)");
const { data: simple, error: err1 } = await client
  .from("substations")
  .select("*")
  .order("name");

if (err1) {
  console.log("❌ ERROR:", err1.message);
} else {
  console.log(`✅ ${simple?.length ?? 0} rows`);
}

console.log("\nTest 2: With sub-relations");
const { data: withRels, error: err2 } = await client
  .from("substations")
  .select("*, transformers(*), feeders(*)")
  .order("name");

if (err2) {
  console.log("❌ ERROR:", err2.message);
} else {
  console.log(`✅ ${withRels?.length ?? 0} rows`);
  if (withRels && withRels[0]) {
    console.log(`  First row transformers: ${withRels[0].transformers?.length ?? 0}`);
    console.log(`  First row feeders: ${withRels[0].feeders?.length ?? 0}`);
  }
}
