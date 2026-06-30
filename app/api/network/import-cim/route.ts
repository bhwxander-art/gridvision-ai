/**
 * POST /api/network/import-cim
 *
 * Accepts a multipart/form-data upload of an IEC 61970 CIM XML file
 * and persists the parsed network topology (buses + branches) for the
 * specified tenant.
 *
 * Required form fields:
 *   file       — CIM XML file (.xml)
 *   tenant_id  — tenant UUID
 *   model_name — human-readable name for this network model
 *   iso        — ISO region code: PJM | CAISO | ERCOT | MISO | NYISO | ISONE
 *   model_date — snapshot date in YYYY-MM-DD format
 *
 * Optional form fields:
 *   base_mva   — system MVA base (default 100)
 *   version    — model version string (default "1.0")
 *
 * Returns 201 with CimImportResult on success.
 * Returns 400 for validation errors, 413 for oversized files, 500 for DB errors.
 */

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NetworkRepository } from "@/lib/db/repositories/network.repository";
import { importCimToNetwork } from "@/lib/parsers/cim/cim-pipeline";
import type { IsoRegion } from "@/lib/db/types-network";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — large CGMES bundles can be several MB
const ISO_VALUES = new Set<string>(["PJM", "CAISO", "ERCOT", "MISO", "NYISO", "ISONE"]);

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Server configuration error: missing Supabase credentials" },
      { status: 500 }
    );
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid request: expected multipart/form-data" },
      { status: 400 }
    );
  }

  const file = formData.get("file") as File | null;
  const tenantId = (formData.get("tenant_id") as string | null)?.trim();
  const modelName = (formData.get("model_name") as string | null)?.trim();
  const isoRaw = (formData.get("iso") as string | null)?.trim().toUpperCase();
  const modelDate = (formData.get("model_date") as string | null)?.trim();
  const baseMvaRaw = formData.get("base_mva") as string | null;
  const version = (formData.get("version") as string | null)?.trim() || "1.0";

  // Field validation
  const missing: string[] = [];
  if (!file) missing.push("file");
  if (!tenantId) missing.push("tenant_id");
  if (!modelName) missing.push("model_name");
  if (!isoRaw) missing.push("iso");
  if (!modelDate) missing.push("model_date");

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  if (!ISO_VALUES.has(isoRaw!)) {
    return NextResponse.json(
      { error: `Invalid iso value "${isoRaw}". Must be one of: ${[...ISO_VALUES].join(", ")}` },
      { status: 400 }
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(modelDate!)) {
    return NextResponse.json(
      { error: "model_date must be in YYYY-MM-DD format" },
      { status: 400 }
    );
  }

  if (file!.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large (${(file!.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.` },
      { status: 413 }
    );
  }

  // Read file content
  const xmlSource = await file!.text();

  // Light-weight validation: must look like an RDF/CIM document
  if (!xmlSource.includes(":RDF") && !xmlSource.includes("rdf:RDF")) {
    return NextResponse.json(
      { error: "Uploaded file does not appear to be a CIM XML (RDF/XML) document" },
      { status: 400 }
    );
  }

  const baseMva = baseMvaRaw ? parseFloat(baseMvaRaw) : 100;

  const client = createClient(supabaseUrl, supabaseKey);
  const repo = new NetworkRepository(client);

  try {
    const result = await importCimToNetwork(
      xmlSource,
      {
        tenantId: tenantId!,
        iso: isoRaw as IsoRegion,
        modelName: modelName!,
        modelDate: modelDate!,
        version,
        baseMva: isFinite(baseMva) && baseMva > 0 ? baseMva : 100,
      },
      repo
    );

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (
      message.includes("[CimParser]") ||
      message.includes("Validation") ||
      message.includes("required")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: `Import failed: ${message}` },
      { status: 500 }
    );
  }
}
