import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/rbac";
import { createCustomer, listCustomers, updateCustomerStatus } from "@/lib/services/crm.service";
import { handleDatabaseError, handleValidationError } from "@/lib/utils/safe-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CustomerCreateSchema = z.object({
  company_name: z.string().min(2).max(200),
  industry: z.enum(["utility", "developer", "consulting", "other"]),
  utility_type: z.enum(["public", "cooperative", "municipal", "investor-owned"]).optional(),
  service_area: z.string().min(1),
  substations: z.number().min(1),
  annual_capex: z.number().min(0),
  status: z.enum(["prospect", "evaluating", "pilot", "customer", "churned"]).default("prospect"),
  notes: z.string().optional(),
});

// ── GET /api/crm/customers ────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(ctx.role, "data:export")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ customers: [] }, { status: 200 });
  }

  try {
    const client = getServerClient();
    const customers = await listCustomers(client);

    return NextResponse.json({ customers });
  } catch (err) {
    const safe = handleDatabaseError(err, "GET /api/crm/customers");
    return NextResponse.json(safe, { status: 500 });
  }
}

// ── POST /api/crm/customers ───────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentTenant();

  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(ctx.role, "admin:manage_users")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = CustomerCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      handleValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      ),
      { status: 422 }
    );
  }

  try {
    const client = getServerClient();
    const customer = await createCustomer(client, {
      company_name: parsed.data.company_name,
      industry: parsed.data.industry,
      utility_type: parsed.data.utility_type,
      service_area: parsed.data.service_area,
      substations: parsed.data.substations,
      annual_capex: parsed.data.annual_capex,
      status: parsed.data.status,
      engagement_score: 0,
      last_engagement: new Date().toISOString(),
      notes: parsed.data.notes ?? "",
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    const safe = handleDatabaseError(err, "POST /api/crm/customers");
    return NextResponse.json(safe, { status: 500 });
  }
}
