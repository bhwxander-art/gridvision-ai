import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { ImportJobRepository } from "@/lib/db/repositories/import-job.repository";
import {
  parseCSV,
  requireString,
  optionalFloat,
  optionalInt,
  type RowValidationError,
} from "@/lib/utils/csv";

export const dynamic = "force-dynamic";

const VALID_TYPES   = new Set(["utility","data-center-developer","hyperscaler","industrial-customer","investor"]);
const VALID_STATUSES = new Set(["lead","qualified","assessment","proposal","negotiation","won"]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const ctx = await getCurrentTenant();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let text: string;
  let filename: string | null = null;
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file — send field name 'file'" }, { status: 400 });
    filename = file.name; text = await file.text();
  } catch { return NextResponse.json({ error: "Failed to read upload" }, { status: 400 }); }

  const client  = getServerClient();
  const jobRepo = new ImportJobRepository(client);
  const job     = await jobRepo.createJob(ctx.tenantId, "accounts", filename ?? undefined);

  const rows = parseCSV(text);
  if (rows.length === 0) {
    await jobRepo.failJob(job.id, "No data rows");
    return NextResponse.json({ error: "CSV has no data rows" }, { status: 422 });
  }

  const errors: RowValidationError[] = [];
  const valid: Array<Record<string, unknown>> = [];
  const seenNames = new Set<string>();

  rows.forEach((row, i) => {
    const rowIdx = i + 1;
    const rowErrors: RowValidationError[] = [];

    const name = requireString(row, "name", rowIdx, rowErrors);
    const type = requireString(row, "type", rowIdx, rowErrors);

    if (type && !VALID_TYPES.has(type)) {
      rowErrors.push({ row: rowIdx, field: "type", message: `Invalid type "${type}". Must be one of: ${[...VALID_TYPES].join(", ")}` });
    }

    const status  = row["status"]?.trim() || "lead";
    if (status && !VALID_STATUSES.has(status)) {
      rowErrors.push({ row: rowIdx, field: "status", message: `Invalid status "${status}"` });
    }

    const annualLoadMW       = optionalFloat(row, "annual_load_mw",       rowIdx, rowErrors, { min: 0 });
    const projectedGrowthMW  = optionalFloat(row, "projected_growth_mw",  rowIdx, rowErrors, { min: 0 });
    const estimatedARR       = optionalInt(  row, "estimated_arr",         rowIdx, rowErrors, { min: 0 });
    const dealProbability    = optionalInt(  row, "deal_probability",      rowIdx, rowErrors, { min: 0, max: 100 });
    const capacityRequiredMW = optionalFloat(row, "capacity_required_mw",  rowIdx, rowErrors, { min: 0 });

    if (name && seenNames.has(name.toLowerCase())) {
      rowErrors.push({ row: rowIdx, field: "name", message: `Duplicate name: "${name}"` });
    }
    if (name) seenNames.add(name.toLowerCase());

    if (rowErrors.length > 0) { errors.push(...rowErrors); return; }

    valid.push({
      id:                    (row["id"]?.trim()) || `acc-${crypto.randomUUID().slice(0, 8)}`,
      tenant_id:             ctx.tenantId,
      name:                  name!,
      type:                  type!,
      status,
      annual_load_mw:        annualLoadMW       ?? 0,
      projected_growth_mw:   projectedGrowthMW  ?? 0,
      territory:             row["territory"]?.trim()     || null,
      estimated_revenue_usd: estimatedARR       ?? 0,
      estimated_arr:         estimatedARR       ?? 0,
      deal_probability:      dealProbability    ?? 0,
      capacity_required_mw:  capacityRequiredMW ?? 0,
      priority:              row["priority"]?.trim()      || "medium",
      risk_rating:           row["risk_rating"]?.trim()   || "medium",
      contact_name:          row["contact_name"]?.trim()  || null,
      contact_title:         row["contact_title"]?.trim() || null,
      notes:                 row["notes"]?.trim()         || null,
    });
  });

  let inserted = 0;
  if (valid.length > 0) {
    const { error: upsertErr } = await client.from("accounts").upsert(valid, { onConflict: "id" });
    if (upsertErr) { await jobRepo.failJob(job.id, upsertErr.message); return NextResponse.json({ error: upsertErr.message }, { status: 500 }); }
    inserted = valid.length;
  }

  await jobRepo.completeJob(job.id, inserted, errors.length, errors);
  return NextResponse.json({
    jobId: job.id,
    status: errors.length === 0 ? "completed" : inserted > 0 ? "partial" : "failed",
    rowsTotal: rows.length, rowsProcessed: inserted, rowsFailed: errors.length,
    errors: errors.slice(0, 50),
  });
}
