import { NextResponse } from "next/server";
import type { SubstationServiceData } from "@/lib/services/substation.service";
import {
  substationPortfolio,
  planningTerritory,
  loadGrowthAssumptions,
  transformerLoadingTrend,
} from "@/lib/enterprise-data";
import { substations } from "@/lib/sample-data";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { SubstationRepository } from "@/lib/db/repositories/substation.repository";
import type { Substation } from "@/lib/types";

const MOCK_BODY: SubstationServiceData = {
  portfolio: substationPortfolio,
  trend: transformerLoadingTrend,
  simple: substations,
  config: { territory: planningTerritory, loadGrowthAssumptions },
};

export async function GET(): Promise<NextResponse<SubstationServiceData>> {
  // ── 1. Database ────────────────────────────────────────────────────────────
  if (isDbConfigured()) {
    try {
      const repo = new SubstationRepository(getServerClient());
      const portfolio = await repo.findAll();

      const simple: Substation[] = portfolio.map((ss) => {
        const util = ss.peakLoadMW / ss.nameplateMVA;
        const status: Substation["status"] =
          util >= 0.95 ? "capacity-risk" : util >= 0.80 ? "warning" : "normal";
        return {
          id: ss.id.replace("ss-", ""),
          name: ss.name.split(" ").slice(0, 2).join(" "),
          status,
          load: ss.peakLoadMW,
          capacity: ss.nameplateMVA,
          latitude: ss.latitude,
          longitude: ss.longitude,
          region: ss.region,
        };
      });

      const body: SubstationServiceData = {
        portfolio,
        trend: transformerLoadingTrend,
        simple,
        config: { territory: planningTerritory, loadGrowthAssumptions },
      };

      return NextResponse.json(body, {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Data-Source": "db",
        },
      });
    } catch (dbErr) {
      console.error("[api/substations] DB error, falling back to mock:", dbErr);
    }
  }

  // ── 2. Mock fallback ────────────────────────────────────────────────────────
  try {
    return NextResponse.json(MOCK_BODY, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Data-Source": "mock",
      },
    });
  } catch (err) {
    console.error("[api/substations] handler error", err);
    return NextResponse.json(
      { error: "Failed to load substation data" } as unknown as SubstationServiceData,
      { status: 500 }
    );
  }
}
