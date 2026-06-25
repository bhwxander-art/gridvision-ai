import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CSV Import Service for utility asset data
 * Supports substations, transformers, feeders
 */

// ── CSV Record Types ───────────────────────────────────────────────────────────

export interface SubstationCSVRecord {
  substation_id: string;
  name: string;
  region: string;
  voltage_kv: string;
  nameplate_mva: string;
  peak_load_mw: string;
  latitude?: string;
  longitude?: string;
}

export interface TransformerCSVRecord {
  transformer_id: string;
  substation_id: string;
  name: string;
  capacity_mva: string;
  age_years?: string;
  condition?: string;
}

export interface FeederCSVRecord {
  feeder_id: string;
  substation_id: string;
  name: string;
  voltage_kv: string;
  length_miles?: string;
  conductor_type?: string;
}

// ── Import Validation ──────────────────────────────────────────────────────────

export interface ImportValidationResult {
  isValid: boolean;
  rowsValid: number;
  rowsInvalid: number;
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  preview: unknown[];
}

export function validateSubstationCSV(
  rows: Record<string, string>[]
): ImportValidationResult {
  const errors: { row: number; message: string }[] = [];
  const warnings: { row: number; message: string }[] = [];
  const preview: SubstationCSVRecord[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2 because headers are row 1

    // Required fields
    if (!row.substation_id?.trim()) {
      errors.push({ row: rowNum, message: "Missing required field: substation_id" });
      continue;
    }
    if (!row.name?.trim()) {
      errors.push({ row: rowNum, message: "Missing required field: name" });
      continue;
    }

    // Numeric validation
    if (!isNumeric(row.voltage_kv)) {
      errors.push({ row: rowNum, message: "Invalid voltage_kv (must be numeric)" });
      continue;
    }
    if (!isNumeric(row.nameplate_mva)) {
      errors.push({ row: rowNum, message: "Invalid nameplate_mva (must be numeric)" });
      continue;
    }

    // Optional numeric fields with warnings
    if (row.peak_load_mw && !isNumeric(row.peak_load_mw)) {
      warnings.push({ row: rowNum, message: "Invalid peak_load_mw (using 0)" });
      row.peak_load_mw = "0";
    }

    preview.push({
      substation_id: row.substation_id.trim(),
      name: row.name.trim(),
      region: row.region?.trim() || "Unknown",
      voltage_kv: row.voltage_kv,
      nameplate_mva: row.nameplate_mva,
      peak_load_mw: row.peak_load_mw || "0",
      latitude: row.latitude,
      longitude: row.longitude,
    });
  }

  return {
    isValid: errors.length === 0,
    rowsValid: preview.length,
    rowsInvalid: errors.length,
    errors,
    warnings,
    preview: preview.slice(0, 5), // First 5 rows for preview
  };
}

// ── CSV Parsing ────────────────────────────────────────────────────────────────

export function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }

    rows.push(row);
  }

  return rows;
}

// ── CSV Import to Database ─────────────────────────────────────────────────────

export async function importSubstations(
  client: SupabaseClient,
  tenantId: string,
  records: SubstationCSVRecord[]
): Promise<{ imported: number; failed: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;

  for (const record of records) {
    try {
      await client.from("substations").upsert(
        {
          id: record.substation_id,
          tenant_id: tenantId,
          name: record.name,
          region: record.region,
          voltage_kv: parseFloat(record.voltage_kv),
          nameplate_mva: parseFloat(record.nameplate_mva),
          peak_load_mw: parseFloat(record.peak_load_mw),
          latitude: record.latitude ? parseFloat(record.latitude) : undefined,
          longitude: record.longitude ? parseFloat(record.longitude) : undefined,
        },
        { onConflict: "id" }
      );

      imported++;
    } catch (err) {
      errors.push(`Failed to import ${record.name}: ${String(err)}`);
    }
  }

  return { imported, failed: errors.length, errors };
}

// ── Utility Functions ──────────────────────────────────────────────────────────

function isNumeric(value: string): boolean {
  if (!value || value.trim() === "") return false;
  return !isNaN(parseFloat(value)) && isFinite(Number(value));
}

// ── CSV Template Generation ────────────────────────────────────────────────────

export function generateSubstationCSVTemplate(): string {
  return `substation_id,name,region,voltage_kv,nameplate_mva,peak_load_mw,latitude,longitude
SS-001,Downtown Substation,North,345,500,420,40.7128,-74.0060
SS-002,Airport Substation,South,230,350,280,40.6762,-73.9885
SS-003,Industrial Substation,West,138,250,200,40.7489,-74.0087`;
}

export function generateTransformerCSVTemplate(): string {
  return `transformer_id,substation_id,name,capacity_mva,age_years,condition
T-001,SS-001,Main Transformer 1,250,5,Good
T-002,SS-001,Main Transformer 2,250,15,Fair
T-003,SS-002,Backup Transformer,175,8,Good`;
}

export function generateFeederCSVTemplate(): string {
  return `feeder_id,substation_id,name,voltage_kv,length_miles,conductor_type
F-001,SS-001,Main Feeder North,115,12.5,ACSR
F-002,SS-001,Main Feeder South,115,8.3,ACSR
F-003,SS-002,Secondary Feeder,69,5.2,Copper`;
}
