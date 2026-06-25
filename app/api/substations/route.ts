import { NextResponse } from "next/server";
import type { SubstationServiceData } from "@/lib/services/substation.service";
import type { Substation } from "@/lib/types";
import {
  substationPortfolio,
  planningTerritory,
  loadGrowthAssumptions,
  transformerLoadingTrend,
} from "@/lib/enterprise-data";
import { substations } from "@/lib/sample-data";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { SubstationRepository, lastFindAllDiag } from "@/lib/db/repositories/substation.repository";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { makeProvenance, mockProvenance } from "@/lib/provenance";

const MOCK_BASE = {
  portfolio: substationPortfolio,
  trend: transformerLoadingTrend,
  simple: substations,
  config: { territory: planningTerritory, loadGrowthAssumptions },
};

export async function GET(): Promise<NextResponse<SubstationServiceData>> {
  // ── 1. Database ────────────────────────────────────────────────────────────
  const dbConfigured = isDbConfigured();
  console.log("[/api/substations] isDbConfigured:", dbConfigured);

  if (dbConfigured) {
    try {
      const ctx = await getCurrentTenant();
      console.log("[/api/substations] getCurrentTenant:", ctx ? "ok" : "null");
      if (!ctx) {
        throw new Error("Tenant context required");
      }

      // ── TEMPORARY DIAGNOSTIC: Test each query progressively ──
      const client = getServerClient();
      const diag: any = {};

      // Query A: Simple select
      const resA = await client.from("substations").select("*");
      diag.queryA = {
        rows: resA.data?.length ?? 0,
        error: resA.error?.message ?? "none",
        ids: resA.data?.map((r: any) => r.id).join(",") ?? "",
      };

      // Query B: With transformers
      const resB = await client.from("substations").select("*, transformers(*)");
      diag.queryB = {
        rows: resB.data?.length ?? 0,
        error: resB.error?.message ?? "none",
        ids: resB.data?.map((r: any) => r.id).join(",") ?? "",
      };

      // Query C: With feeders
      const resC = await client.from("substations").select("*, feeders(*)");
      diag.queryC = {
        rows: resC.data?.length ?? 0,
        error: resC.error?.message ?? "none",
        ids: resC.data?.map((r: any) => r.id).join(",") ?? "",
      };

      // Query D: With both
      const resD = await client.from("substations").select("*, transformers(*), feeders(*)");
      diag.queryD = {
        rows: resD.data?.length ?? 0,
        error: resD.error?.message ?? "none",
        ids: resD.data?.map((r: any) => r.id).join(",") ?? "",
      };

      const repo = new SubstationRepository(getServerClient());
      const portfolio = await repo.findAll(ctx.tenantId);
      console.log("[/api/substations] findAll returned:", portfolio.length, "rows");

      // If database returns empty portfolio, use mock data as fallback
      const effectivePortfolio = portfolio.length > 0 ? portfolio : substationPortfolio;

      const simple: Substation[] = effectivePortfolio.map((ss) => {
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

      const now = new Date().toISOString();
      const dataSource = portfolio.length > 0 ? "db" : "db-empty-fallback";
      const body: SubstationServiceData = {
        ...MOCK_BASE,
        portfolio: effectivePortfolio,
        simple,
        _provenance: makeProvenance("Supabase", now, portfolio.length > 0),
      };

      return NextResponse.json(
        { ...body, _diagnostic: diag, _repositoryDiag: lastFindAllDiag },
        {
          headers: {
            "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
            "X-Data-Source": dataSource,
            "X-Diag-A": `rows:${diag.queryA.rows} error:${diag.queryA.error}`,
            "X-Diag-B": `rows:${diag.queryB.rows} error:${diag.queryB.error}`,
            "X-Diag-C": `rows:${diag.queryC.rows} error:${diag.queryC.error}`,
            "X-Diag-D": `rows:${diag.queryD.rows} error:${diag.queryD.error}`,
            "X-Repo-Raw-Count": String(lastFindAllDiag?.rawDataCount ?? "?"),
            "X-Repo-Mapped-Count": String(lastFindAllDiag?.mappedCount ?? "?"),
            "X-Repo-Mapping-Error": lastFindAllDiag?.mappingError ?? "none",
          },
        }
      );
    } catch (dbErr) {
      console.error("[api/substations] DB error, falling back to mock:", dbErr);
      console.log("[api/substations] Exception reason:", (dbErr as Error).message);
    }
  } else {
    console.log("[api/substations] DB not configured, using mock fallback");
  }

  // ── 2. Mock fallback ────────────────────────────────────────────────────────
  return NextResponse.json(
    { ...MOCK_BASE, _provenance: mockProvenance() },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Data-Source": "mock",
      },
    }
  );
}
