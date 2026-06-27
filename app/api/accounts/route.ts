import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { AccountRepository } from "@/lib/db/repositories/account.repository";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { accounts as mockAccounts, type Account } from "@/lib/data/accounts";
import { makeProvenance, mockProvenance } from "@/lib/provenance";

export const dynamic = "force-dynamic";

export interface AccountsResponse {
  accounts: Account[];
  tenantId: string | null;
  source: "db" | "mock";
  count: number;
  _provenance?: ReturnType<typeof makeProvenance> | ReturnType<typeof mockProvenance>;
}

export async function GET(req: NextRequest): Promise<NextResponse<AccountsResponse | { error: string }>> {
  try {
    const ctx = await getCurrentTenant();
    const tenantId = ctx?.tenantId ?? null;

    // ── 1. Try database ────────────────────────────────────────────────────────
    if (isDbConfigured() && tenantId) {
      try {
        const repo = new AccountRepository(getServerClient());
        const accounts = await repo.findAll(tenantId);

        if (accounts.length > 0) {
          const now = new Date().toISOString();
          return NextResponse.json(
            {
              accounts,
              tenantId,
              source: "db",
              count: accounts.length,
              _provenance: makeProvenance("Supabase", now, false),
            },
            {
              headers: {
                "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
                "X-Data-Source": "db",
              },
            }
          );
        }
        // Table exists but is empty — fall through to seed check / mock
      } catch (err) {
        console.error("[api/accounts] DB error:", err);
        // Fall through to mock fallback
      }
    }

    // ── 2. Fallback ───────────────────────────────────────────────────────────
    // In development, return mock data so local work is easy.
    // In production, return empty array — do not serve fake data to real users.
    const isDev = process.env.NODE_ENV !== "production";
    if (isDev) {
      return NextResponse.json(
        {
          accounts: mockAccounts,
          tenantId,
          source: "mock",
          count: mockAccounts.length,
          _provenance: mockProvenance(),
        },
        {
          headers: {
            "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
            "X-Data-Source": "mock",
          },
        }
      );
    }

    return NextResponse.json(
      {
        accounts: [],
        tenantId,
        source: "db",
        count: 0,
        _provenance: mockProvenance("no-data"),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
          "X-Data-Source": "empty",
        },
      }
    );
  } catch (err) {
    console.error("[api/accounts] Error:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
