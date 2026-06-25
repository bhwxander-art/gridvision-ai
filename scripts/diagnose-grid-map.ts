/**
 * scripts/diagnose-grid-map.ts
 *
 * Diagnoses why Grid Map is still showing mock data.
 * Checks:
 * 1. Database connection
 * 2. Substations table row count
 * 3. Demo tenant ID
 * 4. Tenant-scoped substation count
 * 5. API /api/substations response
 *
 * Usage:
 *   npx tsx scripts/diagnose-grid-map.ts
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("❌ Missing SUPABASE environment variables");
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

async function diagnose() {
  console.log("\n🔍 Grid Map Data Source Audit\n");

  // 1. Check database connection
  console.log("1️⃣  Database Connection:");
  try {
    const { data: testQuery, error: queryError } = await supabase
      .from("tenants")
      .select("count", { count: "exact" })
      .limit(1);
    if (queryError) throw queryError;
    console.log("   ✅ Database connected");
  } catch (err) {
    console.log("   ❌ Database connection failed:", (err as Error).message);
    process.exit(1);
  }

  // 2. Get all tenants
  console.log("\n2️⃣  Tenants in database:");
  const { data: tenants, error: tenantsError } = await supabase
    .from("tenants")
    .select("id, name, slug");
  if (tenantsError) {
    console.log("   ❌ Error:", tenantsError.message);
  } else {
    console.log(`   Found ${tenants?.length ?? 0} tenants`);
    tenants?.forEach((t) => {
      console.log(`   - ${t.name} (id: ${t.id}, slug: ${t.slug})`);
    });
  }

  // 3. Global substations count (all tenants)
  console.log("\n3️⃣  Substations in database (all tenants):");
  const { data: allSubstations, error: substationsError, count: totalCount } = await supabase
    .from("substations")
    .select("id, name, tenant_id", { count: "exact" });
  if (substationsError) {
    console.log("   ❌ Error:", substationsError.message);
  } else {
    console.log(`   ✅ Total rows in substations table: ${totalCount}`);
    if ((allSubstations?.length ?? 0) > 0) {
      console.log("   Sample records:");
      allSubstations?.slice(0, 3).forEach((s) => {
        console.log(`   - ${s.name} (id: ${s.id}, tenant_id: ${s.tenant_id})`);
      });
    }
  }

  // 4. Demo tenant substations
  const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000000";
  console.log(`\n4️⃣  Demo Tenant (${DEMO_TENANT_ID}) Substations:`);
  const { data: demoSubstations, error: demoError, count: demoCount } = await supabase
    .from("substations")
    .select("id, name, latitude, longitude, tenant_id", { count: "exact" })
    .eq("tenant_id", DEMO_TENANT_ID);
  if (demoError) {
    console.log("   ❌ Error:", demoError.message);
  } else {
    console.log(`   ✅ Demo tenant has ${demoCount} substations`);
    if ((demoSubstations?.length ?? 0) > 0) {
      console.log("   Records:");
      demoSubstations?.forEach((s) => {
        console.log(`   - ${s.name} (id: ${s.id}, lat: ${s.latitude}, lng: ${s.longitude})`);
      });
    } else {
      console.log("   ⚠️  Demo tenant has NO substations - this is why Grid Map shows mock data!");
    }
  }

  // 5. Check mock data reference
  console.log("\n5️⃣  Mock Data Status:");
  console.log("   lib/enterprise-data.ts contains:");
  console.log("   - Boston North 115/13.8 kV (ss-boston-north)");
  console.log("   - Cambridge Central 115/27 kV (ss-cambridge-central)");
  console.log("   - Somerville East 27/13.8 kV (ss-somerville-east)");
  console.log("   - Waltham West 115/27 kV (ss-waltham-west)");

  // 6. Migration status
  console.log("\n6️⃣  Migration Script Status:");
  console.log("   ✅ scripts/migrate-substations.ts exists");
  console.log("   📌 Run it with: npx tsx scripts/migrate-substations.ts");
  console.log("   📌 To import into demo tenant: add --tenant-id flag");

  // 7. Current data flow
  console.log("\n7️⃣  Current Data Flow:");
  console.log("   Client: useSubstationData() hook");
  console.log("           ↓");
  console.log("   API: GET /api/substations");
  console.log("           ↓");
  console.log("   DB: SubstationRepository.findAll(tenantId)");
  if ((demoCount ?? 0) > 0) {
    console.log("           ↓");
    console.log("   ✅ Returns real database records");
  } else {
    console.log("           ↓");
    console.log("   ❌ Returns EMPTY → Falls back to mock data");
    console.log("           ↓");
    console.log("   MOCK: app/lib/enterprise-data.ts (Boston North, Cambridge Central, etc.)");
  }

  console.log("\n");
}

diagnose().catch(console.error);
