import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { ImportJobRepository } from "@/lib/db/repositories/import-job.repository";
import {
  parseCSV,
  requireString,
  optionalFloat,
  optionalInt,
  optionalBool,
  type RowValidationError,
} from "@/lib/utils/csv";

export const dynamic = "force-dynamic";

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
  const job     = await jobRepo.createJob(ctx.tenantId, "transformers", filename ?? undefined);

  const rows = parseCSV(text);
  if (rows.length === 0) {
    await jobRepo.failJob(job.id, "No data rows");
    return NextResponse.json({ error: "CSV has no data rows" }, { status: 422 });
  }

  const errors: RowValidationError[] = [];
  const valid: Array<Record<string, unknown>> = [];

  rows.forEach((row, i) => {
    const rowIdx = i + 1;
    const rowErrors: RowValidationError[] = [];

    const name          = requireString(row, "name",          rowIdx, rowErrors);
    const substationId  = requireString(row, "substation_id", rowIdx, rowErrors);
    const ratedMVA      = optionalFloat(row, "rated_mva",     rowIdx, rowErrors, { min: 0.1 });
    const peakLoadMVA   = optionalFloat(row, "peak_load_mva", rowIdx, rowErrors, { min: 0 });
    const loadFactor    = optionalFloat(row, "load_factor",   rowIdx, rowErrors, { min: 0, max: 1 });
    const ageYears      = optionalInt(  row, "age_years",     rowIdx, rowErrors, { min: 0, max: 200 });

    if (rowErrors.length > 0) { errors.push(...rowErrors); return; }

    valid.push({
      id:            (row["id"]?.trim()) || `tx-${crypto.randomUUID().slice(0, 8)}`,
      tenant_id:     ctx.tenantId,
      substation_id: substationId!,
      name:          name!,
      rated_mva:     ratedMVA    ?? 0,
      peak_load_mva: peakLoadMVA ?? 0,
      load_factor:   loadFactor  ?? 0.9,
      age_years:     ageYears    ?? 0,
      n1_compliant:  optionalBool(row, "n1_compliant"),
    });
  });

  let inserted = 0;
  if (valid.length > 0) {
    const { error: upsertErr } = await client.from("transformers").upsert(valid, { onConflict: "id" });
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
