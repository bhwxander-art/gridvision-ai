import { NextRequest, NextResponse } from "next/server";
import { isDbConfigured, getServerClient } from "@/lib/db/client";
import { getCurrentTenant } from "@/lib/auth/tenant";
import { ImportJobRepository } from "@/lib/db/repositories/import-job.repository";
import {
  parseCSV,
  requireString,
  optionalFloat,
  type RowValidationError,
} from "@/lib/utils/csv";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const ctx = await getCurrentTenant();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Parse multipart form ──────────────────────────────────────────────────
  let text: string;
  let filename: string | null = null;
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded — send field name 'file'" }, { status: 400 });
    filename = file.name;
    text     = await file.text();
  } catch {
    return NextResponse.json({ error: "Failed to read upload" }, { status: 400 });
  }

  const client    = getServerClient();
  const jobRepo   = new ImportJobRepository(client);
  const job       = await jobRepo.createJob(ctx.tenantId, "substations", filename ?? undefined);

  // ── Parse CSV ─────────────────────────────────────────────────────────────
  const rows = parseCSV(text);
  if (rows.length === 0) {
    await jobRepo.failJob(job.id, "CSV has no data rows");
    return NextResponse.json({ error: "CSV has no data rows" }, { status: 422 });
  }

  const errors: RowValidationError[] = [];
  const valid: Array<Record<string, unknown>> = [];
  const seenNames = new Set<string>();

  rows.forEach((row, i) => {
    const rowIdx = i + 1;
    const rowErrors: RowValidationError[] = [];

    const name = requireString(row, "name", rowIdx, rowErrors);
    const lat  = optionalFloat(row, "latitude",  rowIdx, rowErrors, { min: -90,  max: 90  });
    const lng  = optionalFloat(row, "longitude", rowIdx, rowErrors, { min: -180, max: 180 });
    const peakLoadMW   = optionalFloat(row, "peak_load_mw",    rowIdx, rowErrors, { min: 0 });
    const nameplateMVA = optionalFloat(row, "nameplate_mva",   rowIdx, rowErrors, { min: 0 });
    const n1CapacityMW = optionalFloat(row, "n1_capacity_mw",  rowIdx, rowErrors, { min: 0 });
    const voltageKV    = optionalFloat(row, "voltage_kv",      rowIdx, rowErrors, { min: 0 });
    const growthPct    = optionalFloat(row, "annual_growth_pct", rowIdx, rowErrors, { min: 0 });

    if (name && seenNames.has(name.toLowerCase())) {
      rowErrors.push({ row: rowIdx, field: "name", message: `Duplicate name: "${name}"` });
    }
    if (name) seenNames.add(name.toLowerCase());

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    const id = (row["id"]?.trim()) || `ss-${crypto.randomUUID().slice(0, 8)}`;
    valid.push({
      id,
      tenant_id:         ctx.tenantId,
      name:              name!,
      region:            row["region"]?.trim() || "Unassigned",
      voltage_kv:        voltageKV   ?? 115,
      nameplate_mva:     nameplateMVA ?? 0,
      peak_load_mw:      peakLoadMW  ?? 0,
      n1_capacity_mw:    n1CapacityMW ?? 0,
      annual_growth_pct: growthPct   ?? 0,
      latitude:          lat  ?? 0,
      longitude:         lng  ?? 0,
    });
  });

  // ── Upsert valid rows ─────────────────────────────────────────────────────
  let inserted = 0;
  if (valid.length > 0) {
    const { error: upsertErr } = await client
      .from("substations")
      .upsert(valid, { onConflict: "id" });
    if (upsertErr) {
      await jobRepo.failJob(job.id, upsertErr.message);
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
    inserted = valid.length;
  }

  await jobRepo.completeJob(job.id, inserted, errors.length, errors);

  return NextResponse.json({
    jobId:         job.id,
    status:        errors.length === 0 ? "completed" : inserted > 0 ? "partial" : "failed",
    rowsTotal:     rows.length,
    rowsProcessed: inserted,
    rowsFailed:    errors.length,
    errors:        errors.slice(0, 50),
  });
}
