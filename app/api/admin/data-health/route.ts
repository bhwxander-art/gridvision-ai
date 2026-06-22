import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { fetchISONeGridLoad } from "@/lib/adapters/isone.adapter";
import { fetchRegionalLoadGrowth } from "@/lib/adapters/eia.adapter";
import { fetchCountyPopulation } from "@/lib/adapters/census.adapter";

export interface SourceStatus {
  name: string;
  status: "live" | "mock" | "unconfigured" | "error";
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
}

export interface DataHealthResponse {
  checkedAt: string;
  sources: {
    isone: SourceStatus;
    eia: SourceStatus;
    census: SourceStatus;
    supabase: SourceStatus;
  };
}

async function checkISONE(): Promise<SourceStatus> {
  const checkedAt = new Date().toISOString();
  if (!process.env.ISONE_API_USER || !process.env.ISONE_API_PASSWORD) {
    return { name: "ISO New England", status: "unconfigured", latencyMs: null, detail: "ISONE_API_USER / ISONE_API_PASSWORD not set", checkedAt };
  }
  const t0 = Date.now();
  try {
    const result = await fetchISONeGridLoad();
    const latencyMs = Date.now() - t0;
    if (result.provenance.dataQuality === "mock") {
      return { name: "ISO New England", status: "mock", latencyMs, detail: "Credentials present but API returned mock fallback", checkedAt };
    }
    return { name: "ISO New England", status: "live", latencyMs, detail: `Load: ${result.currentLoad.toLocaleString()} MW at ${result.timestamp}`, checkedAt };
  } catch (err) {
    return { name: "ISO New England", status: "error", latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err), checkedAt };
  }
}

async function checkEIA(): Promise<SourceStatus> {
  const checkedAt = new Date().toISOString();
  if (!process.env.EIA_API_KEY) {
    return { name: "U.S. EIA", status: "unconfigured", latencyMs: null, detail: "EIA_API_KEY not set", checkedAt };
  }
  const t0 = Date.now();
  try {
    const result = await fetchRegionalLoadGrowth();
    const latencyMs = Date.now() - t0;
    const prov = (result as typeof result & { provenance?: { dataQuality: string } }).provenance;
    if (prov?.dataQuality === "mock") {
      return { name: "U.S. EIA", status: "mock", latencyMs, detail: "Key present but API returned mock fallback", checkedAt };
    }
    return { name: "U.S. EIA", status: "live", latencyMs, detail: `${result.length} annual data points loaded`, checkedAt };
  } catch (err) {
    return { name: "U.S. EIA", status: "error", latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err), checkedAt };
  }
}

async function checkCensus(): Promise<SourceStatus> {
  const checkedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const result = await fetchCountyPopulation(2023);
    const latencyMs = Date.now() - t0;
    const prov = (result as typeof result & { provenance?: { dataQuality: string } }).provenance;
    if (prov?.dataQuality === "mock") {
      return { name: "U.S. Census Bureau", status: "mock", latencyMs, detail: "API unreachable; using mock county data", checkedAt };
    }
    return { name: "U.S. Census Bureau", status: "live", latencyMs, detail: `${result.length} county metrics loaded`, checkedAt };
  } catch (err) {
    return { name: "U.S. Census Bureau", status: "error", latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err), checkedAt };
  }
}

async function checkSupabase(): Promise<SourceStatus> {
  const checkedAt = new Date().toISOString();
  if (!isDbConfigured()) {
    return { name: "Supabase", status: "unconfigured", latencyMs: null, detail: "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", checkedAt };
  }
  const t0 = Date.now();
  try {
    const client = getServerClient();
    const { error } = await client.from("grid_load_history").select("id").limit(1);
    const latencyMs = Date.now() - t0;
    if (error) throw new Error(error.message);
    return { name: "Supabase", status: "live", latencyMs, detail: "Connection healthy; grid_load_history accessible", checkedAt };
  } catch (err) {
    return { name: "Supabase", status: "error", latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err), checkedAt };
  }
}

export async function GET(): Promise<NextResponse<DataHealthResponse>> {
  const checkedAt = new Date().toISOString();
  const [isone, eia, census, supabase] = await Promise.all([
    checkISONE(),
    checkEIA(),
    checkCensus(),
    checkSupabase(),
  ]);

  return NextResponse.json(
    { checkedAt, sources: { isone, eia, census, supabase } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
