import { NextResponse } from "next/server";
import type { DataCenterInterconnection } from "@/lib/types";
import { dataCenterQueue } from "@/lib/enterprise-data";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { DataCenterRepository } from "@/lib/db/repositories/datacenter.repository";

export async function GET(): Promise<NextResponse<DataCenterInterconnection[]>> {
  // ── 1. Database ────────────────────────────────────────────────────────────
  if (isDbConfigured()) {
    try {
      const repo = new DataCenterRepository(getServerClient());
      const queue = await repo.findAll();

      return NextResponse.json(queue, {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Data-Source": "db",
        },
      });
    } catch (dbErr) {
      console.error("[api/datacenters] DB error, falling back to mock:", dbErr);
    }
  }

  // ── 2. Mock fallback ────────────────────────────────────────────────────────
  try {
    return NextResponse.json(dataCenterQueue, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "X-Data-Source": "mock",
      },
    });
  } catch (err) {
    console.error("[api/datacenters] handler error", err);
    return NextResponse.json([] as DataCenterInterconnection[], { status: 500 });
  }
}
