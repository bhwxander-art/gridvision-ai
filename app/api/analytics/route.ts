import { NextResponse } from "next/server";
import type { AnalyticsData } from "@/lib/types";
import type { ProvenanceInfo } from "@/lib/provenance";
import { makeProvenance, mockProvenance } from "@/lib/provenance";
import { fetchEIAAnalyticsData } from "@/lib/adapters/eia.adapter";

type AnalyticsResponse = AnalyticsData & { _provenance: ProvenanceInfo };

export async function GET(): Promise<NextResponse<AnalyticsResponse>> {
  try {
    const { provenance: adapterProv, ...analyticsData } = await fetchEIAAnalyticsData();
    const prov = makeProvenance(
      adapterProv.sourceName,
      adapterProv.fetchedAt,
      adapterProv.dataQuality === "mock"
    );

    return NextResponse.json(
      { ...analyticsData, _provenance: prov },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200",
          "X-Data-Source": adapterProv.dataQuality,
        },
      }
    );
  } catch (err) {
    console.error("[api/analytics] handler error", err);
    return NextResponse.json(
      { error: "Failed to load analytics" } as unknown as AnalyticsResponse,
      { status: 500 }
    );
  }
}
