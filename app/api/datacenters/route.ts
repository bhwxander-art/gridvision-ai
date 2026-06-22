import { NextResponse } from "next/server";
import type { DataCenterQueueResponse } from "@/lib/types";
import { dataCenterQueue } from "@/lib/enterprise-data";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { DataCenterRepository } from "@/lib/db/repositories/datacenter.repository";
import { makeProvenance, mockProvenance } from "@/lib/provenance";

export async function GET(): Promise<NextResponse<DataCenterQueueResponse>> {
  // ── 1. Database ────────────────────────────────────────────────────────────
  if (isDbConfigured()) {
    try {
      const repo = new DataCenterRepository(getServerClient());
      const queue = await repo.findAll();
      const now = new Date().toISOString();

      return NextResponse.json(
        { queue, _provenance: makeProvenance("Supabase", now, false) },
        {
          headers: {
            "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
            "X-Data-Source": "db",
          },
        }
      );
    } catch (dbErr) {
      console.error("[api/datacenters] DB error, falling back to mock:", dbErr);
    }
  }

  // ── 2. Mock fallback ────────────────────────────────────────────────────────
  return NextResponse.json(
    { queue: dataCenterQueue, _provenance: mockProvenance() },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Data-Source": "mock",
      },
    }
  );
}
