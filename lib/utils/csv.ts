// ── CSV parser (no dependencies, client-safe) ─────────────────────────────────

/**
 * Parses CSV text into an array of row objects keyed by header name.
 * Headers are lowercased and spaces replaced with underscores.
 * Handles quoted fields, double-quote escaping, and CRLF line endings.
 */
export function parseCSV(text: string): Array<Record<string, string>> {
  // Normalize line endings and strip BOM
  const normalised = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalised.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) =>
    h.toLowerCase().trim().replace(/\s+/g, "_")
  );

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (values[i] ?? "").trim();
    });
    return record;
  });
}

/** Splits one CSV line respecting quoted fields and double-quote escaping. */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current  = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Validation helpers ────────────────────────────────────────────────────────

export interface RowValidationError {
  row:     number;   // 1-based row index (after header)
  field:   string;
  message: string;
}

export function requireString(
  row: Record<string, string>,
  field: string,
  rowIdx: number,
  errors: RowValidationError[]
): string {
  const v = row[field]?.trim() ?? "";
  if (!v) errors.push({ row: rowIdx, field, message: `${field} is required` });
  return v;
}

export function optionalFloat(
  row: Record<string, string>,
  field: string,
  rowIdx: number,
  errors: RowValidationError[],
  opts: { min?: number; max?: number } = {}
): number | null {
  const raw = row[field]?.trim();
  if (!raw) return null;
  const n = parseFloat(raw);
  if (isNaN(n)) {
    errors.push({ row: rowIdx, field, message: `${field} must be a number` });
    return null;
  }
  if (opts.min !== undefined && n < opts.min) {
    errors.push({ row: rowIdx, field, message: `${field} must be ≥ ${opts.min}` });
    return null;
  }
  if (opts.max !== undefined && n > opts.max) {
    errors.push({ row: rowIdx, field, message: `${field} must be ≤ ${opts.max}` });
    return null;
  }
  return n;
}

export function optionalInt(
  row: Record<string, string>,
  field: string,
  rowIdx: number,
  errors: RowValidationError[],
  opts: { min?: number; max?: number } = {}
): number | null {
  const v = optionalFloat(row, field, rowIdx, errors, opts);
  return v === null ? null : Math.round(v);
}

export function optionalBool(row: Record<string, string>, field: string): boolean {
  const v = row[field]?.trim().toLowerCase() ?? "";
  return v === "true" || v === "1" || v === "yes";
}

// ── Template definitions ──────────────────────────────────────────────────────

export type ImportEntityType = "substations" | "transformers" | "feeders" | "accounts";

export interface ImportTemplate {
  columns:     string[];
  requiredCols: string[];
  exampleRow:  string;
  description: string;
}

export const IMPORT_TEMPLATES: Record<ImportEntityType, ImportTemplate> = {
  substations: {
    columns:      ["name", "region", "voltage_kv", "nameplate_mva", "peak_load_mw", "n1_capacity_mw", "annual_growth_pct", "latitude", "longitude"],
    requiredCols: ["name"],
    exampleRow:   "Boston North,North Shore,115,450,342,405,3.2,42.4671,-70.9437",
    description:  "Each row becomes one substation record. `name` is required. Coordinates and capacity fields are optional but recommended.",
  },
  transformers: {
    columns:      ["name", "substation_id", "rated_mva", "peak_load_mva", "load_factor", "age_years", "n1_compliant"],
    requiredCols: ["name", "substation_id"],
    exampleRow:   "T1 150 MVA,ss-boston-north,150,118,0.92,22,true",
    description:  "`substation_id` must match an existing substation ID in your workspace.",
  },
  feeders: {
    columns:      ["name", "substation_id", "hosting_capacity_mw", "committed_load_mw", "queued_load_mw"],
    requiredCols: ["name", "substation_id"],
    exampleRow:   "Feeder 12 — Lynn,ss-boston-north,45,28,8",
    description:  "`substation_id` must match an existing substation in your workspace.",
  },
  accounts: {
    columns:      ["name", "type", "status", "territory", "annual_load_mw", "projected_growth_mw", "estimated_arr", "deal_probability", "contact_name", "contact_title", "notes"],
    requiredCols: ["name", "type"],
    exampleRow:   "Eversource Energy,utility,negotiation,New England,12400,1800,4100000,90,Amanda Pierce,Director Grid Modernization,Primary territory partner",
    description:  "`type` must be one of: utility · data-center-developer · hyperscaler · industrial-customer · investor",
  },
};

/** Generates a CSV template string for download. */
export function generateCSVTemplate(type: ImportEntityType): string {
  const t = IMPORT_TEMPLATES[type];
  return t.columns.join(",") + "\n" + t.exampleRow + "\n";
}
