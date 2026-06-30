/**
 * Shared normalization helpers for the ISO queue ingestion pipeline.
 *
 * Each ISO uses different date formats, status strings, and fuel type codes.
 * These pure functions translate ISO-specific strings into the canonical
 * types defined in lib/db/types-queue.ts.
 */

import type { ProjectType, QueueStatus } from "@/lib/db/types-queue";

// ── Date parsing ──────────────────────────────────────────────────────────────

const RE_YYYYMMDD = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_MMDDYYYY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const RE_MMDDYY   = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/;
const RE_YYYYMMDD_SLASH = /^(\d{4})\/(\d{2})\/(\d{2})$/;

/**
 * Parse any of the common US date formats ISOs use into "YYYY-MM-DD".
 * Returns null for blank, "N/A", "TBD", "Unknown", or unparseable values.
 */
export function parseIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || /^(n\/a|tbd|unknown|pending|-)$/i.test(s)) return null;

  let m: RegExpMatchArray | null;

  m = s.match(RE_YYYYMMDD);
  if (m) return s; // already canonical

  m = s.match(RE_YYYYMMDD_SLASH);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = s.match(RE_MMDDYYYY);
  if (m) {
    const month = m[1].padStart(2, "0");
    const day   = m[2].padStart(2, "0");
    return `${m[3]}-${month}-${day}`;
  }

  m = s.match(RE_MMDDYY);
  if (m) {
    const year  = parseInt(m[3]) < 70 ? `20${m[3]}` : `19${m[3]}`;
    const month = m[1].padStart(2, "0");
    const day   = m[2].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Last attempt: let Date() parse it, but only accept strings that contain a
  // separator character (/ or -). Bare numerics like "12345" should not be
  // treated as dates — JavaScript would interpret them as year-only, which is
  // almost always garbage data from a numeric cell in a spreadsheet.
  if (/[\/\-]/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const year  = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day   = String(d.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }

  return null;
}

// ── MW parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a capacity MW value that may be a string like "100.5", "1,200", or "N/A".
 * Returns null for blanks and non-numeric values.
 */
export function parseMw(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return isFinite(raw) && raw > 0 ? raw : null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned || /^(n\/a|tbd|-)$/i.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return isFinite(n) && n > 0 ? n : null;
}

// ── Project type mapping ──────────────────────────────────────────────────────

const PROJECT_TYPE_MAP: Array<[RegExp, ProjectType]> = [
  [/offshore\s+wind/i,                   "wind_offshore"],
  [/onshore\s+wind|^wind$/i,             "wind_onshore"],
  [/(solar|pv|photovoltaic).*(storage|battery)/i, "solar_plus_storage"],
  [/(storage|battery).*(solar|pv)/i,     "solar_plus_storage"],
  [/solar|pv|photovoltaic/i,             "solar"],
  [/battery|bess|energy\s+storage|li\-?ion/i, "battery_storage"],
  [/nuclear/i,                           "nuclear"],
  [/natural\s+gas|ng\b|ccgt|ctg|combustion\s+turbine|combined\s+cycle/i, "natural_gas"],
  [/hydro(electric)?/i,                  "hydro"],
  [/geothermal/i,                        "geothermal"],
  [/wind/i,                              "wind_onshore"],  // fallback for bare "wind"
  [/load|demand/i,                       "load"],
];

export function mapProjectType(raw: string | null | undefined): ProjectType {
  if (!raw) return "other_generation";
  const s = raw.trim();
  for (const [re, type] of PROJECT_TYPE_MAP) {
    if (re.test(s)) return type;
  }
  return "other_generation";
}

// ── Queue status mapping ──────────────────────────────────────────────────────

const STATUS_MAP: Array<[RegExp, QueueStatus]> = [
  [/in[\s_-]?service|online|operational|commercial\s+op/i, "in_service"],
  [/withdrawn|suspend|cancel|terminated/i,                 "withdrawn"],
  [/executed\s+ia|ia\s+exec|signed\s+ia|active\s+ia/i,    "executed_ia"],
  [/phase\s*3|facilities\s*study|3rd\s*study/i,            "study_phase_3"],
  [/phase\s*2|system\s*impact|2nd\s*study/i,               "study_phase_2"],
  [/phase\s*1|scoping|feasibility|1st\s*study/i,           "study_phase_1"],
  [/active|submitted|new|pending|queue(d)?|under\s+review/i, "submitted"],
];

export function mapQueueStatus(raw: string | null | undefined): QueueStatus {
  if (!raw) return "submitted";
  const s = raw.trim();
  for (const [re, status] of STATUS_MAP) {
    if (re.test(s)) return status;
  }
  return "submitted"; // safe default — treat unknown as newly submitted
}

// ── Cost parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a dollar/million value from strings like "$1.5M", "1,500,000", "1.5".
 * Returns the value in millions of dollars, or null if unparseable.
 */
export function parseCostMillions(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  let s = raw.replace(/\$/g, "").replace(/,/g, "").trim();
  if (!s || /^(n\/a|tbd|-)$/i.test(s)) return null;

  const inMillions = /M$/i.test(s);
  const inBillions = /B$/i.test(s);
  s = s.replace(/[MB]$/i, "");

  const n = parseFloat(s);
  if (!isFinite(n)) return null;

  if (inBillions) return n * 1000;
  if (inMillions) return n;
  // Only treat the value as a raw dollar amount when it exceeds 1,000,000.
  // Values below that threshold are assumed to already be in millions
  // ($1,200 as a network upgrade cost is meaningless; $1,200M is plausible).
  if (n > 1_000_000) return n / 1_000_000;
  return n; // assume already in millions
}
