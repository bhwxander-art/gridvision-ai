import { NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export interface DataFreshnessStatus {
  isoNeLoad: {
    lastUpdate: string | null;
    ageMinutes: number | null;
    stale: boolean;
  };
  capacity: {
    lastUpdate: string | null;
    ageMinutes: number | null;
    stale: boolean;
  };
  assets: {
    lastUpdate: string | null;
    ageMinutes: number | null;
    stale: boolean;
  };
  accounts: {
    lastUpdate: string | null;
    ageMinutes: number | null;
    stale: boolean;
  };
  timestamp: string;
}

// ── Thresholds (in minutes) ────────────────────────────────────────────────────

const FRESHNESS_THRESHOLDS = {
  LOAD_DATA: 60,          // 1 hour
  CAPACITY_DATA: 7 * 24 * 60,  // 1 week
  ASSETS_DATA: 30 * 24 * 60,   // 30 days
  ACCOUNTS_DATA: 24 * 60,      // 1 day
};

async function getLastUpdateTime(
  client: ReturnType<typeof getServerClient>,
  tableName: string
): Promise<Date | null> {
  try {
    const { data, error } = await client
      .from(tableName)
      .select("updated_at", { count: "exact", head: true })
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return null;
    return new Date(data[0].updated_at);
  } catch {
    return null;
  }
}

function calculateFreshness(lastUpdate: Date | null, thresholdMinutes: number) {
  if (!lastUpdate) {
    return {
      lastUpdate: null,
      ageMinutes: null,
      stale: true,
    };
  }

  const ageMinutes = Math.floor((Date.now() - lastUpdate.getTime()) / 60_000);
  return {
    lastUpdate: lastUpdate.toISOString(),
    ageMinutes,
    stale: ageMinutes > thresholdMinutes,
  };
}

export async function GET(): Promise<NextResponse<DataFreshnessStatus>> {
  const timestamp = new Date().toISOString();

  if (!isDbConfigured()) {
    return NextResponse.json(
      {
        isoNeLoad: { lastUpdate: null, ageMinutes: null, stale: true },
        capacity: { lastUpdate: null, ageMinutes: null, stale: true },
        assets: { lastUpdate: null, ageMinutes: null, stale: true },
        accounts: { lastUpdate: null, ageMinutes: null, stale: true },
        timestamp,
      },
      { status: 200 }
    );
  }

  try {
    const client = getServerClient();

    const [isoNeLastUpdate, capacityLastUpdate, assetsLastUpdate, accountsLastUpdate] = await Promise.all([
      getLastUpdateTime(client, "grid_load_history"),
      getLastUpdateTime(client, "substations"),
      getLastUpdateTime(client, "substations"), // Use same as capacity
      getLastUpdateTime(client, "accounts"),
    ]);

    return NextResponse.json(
      {
        isoNeLoad: calculateFreshness(isoNeLastUpdate, FRESHNESS_THRESHOLDS.LOAD_DATA),
        capacity: calculateFreshness(capacityLastUpdate, FRESHNESS_THRESHOLDS.CAPACITY_DATA),
        assets: calculateFreshness(assetsLastUpdate, FRESHNESS_THRESHOLDS.ASSETS_DATA),
        accounts: calculateFreshness(accountsLastUpdate, FRESHNESS_THRESHOLDS.ACCOUNTS_DATA),
        timestamp,
      },
      {
        headers: {
          "Cache-Control": "max-age=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (err) {
    console.error("[api/system/data-freshness]", err);
    return NextResponse.json(
      {
        isoNeLoad: { lastUpdate: null, ageMinutes: null, stale: true },
        capacity: { lastUpdate: null, ageMinutes: null, stale: true },
        assets: { lastUpdate: null, ageMinutes: null, stale: true },
        accounts: { lastUpdate: null, ageMinutes: null, stale: true },
        timestamp,
      },
      { status: 500 }
    );
  }
}
