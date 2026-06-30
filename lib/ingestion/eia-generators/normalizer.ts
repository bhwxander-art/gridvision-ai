/**
 * EIA generator field normalizers (INFRA-006)
 *
 * Maps raw EIA API field values to the domain types in types-eia-generators.ts.
 * All functions are pure and testable without network access.
 */

import type { GeneratorFuelType, GeneratorStatus } from "@/lib/db/types-eia-generators";

// ── Fuel type mapping ─────────────────────────────────────────────────────────
//
// EIA energy source codes (energy_source_code field) map to our simplified
// GeneratorFuelType enum.  We also do a regex fallback on the technology
// description for rows where the energy source code is absent.

const ENERGY_SOURCE_FUEL_MAP: Record<string, GeneratorFuelType> = {
  // Natural gas
  NG:  "natural_gas",  // natural gas
  LFG: "natural_gas",  // landfill gas (methane-rich)
  OG:  "natural_gas",  // other gas
  BG:  "natural_gas",  // blast furnace gas
  // Coal
  BIT: "coal",         // bituminous
  SUB: "coal",         // sub-bituminous
  LIG: "coal",         // lignite
  ANT: "coal",         // anthracite
  RC:  "coal",         // refined coal
  WC:  "coal",         // waste coal
  SC:  "coal",         // syngas from coal
  // Nuclear
  NUC: "nuclear",
  // Wind
  WND: "wind",
  // Solar
  SUN: "solar",
  // Hydro
  WAT: "hydro",
  // Petroleum / oil
  DFO: "oil",          // distillate fuel oil (diesel)
  RFO: "oil",          // residual fuel oil
  KER: "oil",          // kerosene
  JF:  "oil",          // jet fuel
  WO:  "oil",          // waste oil
  // Geothermal
  GEO: "geothermal",
  // Biomass / waste
  WDS: "biomass",      // wood / wood waste solid
  WDL: "biomass",      // wood waste liquids
  AB:  "biomass",      // agricultural by-products
  MSB: "biomass",      // municipal solid waste — biogenic
  OBG: "other_renewable", // other biomass gas
  OBL: "other_renewable", // other biomass liquid
  OBS: "other_renewable", // other biomass solid
  // Other renewable / storage
  MWH: "other_renewable", // grid-scale battery / energy storage
  PUR: "other_renewable", // purchased steam
  TDF: "other_renewable", // tire-derived fuel
  // Hydrogen (emerging)
  H2:  "other_renewable",
};

const TECHNOLOGY_FUEL_REGEXES: Array<[RegExp, GeneratorFuelType]> = [
  [/nuclear/i,                                 "nuclear"],
  [/offshore\s+wind/i,                         "wind"],
  [/onshore\s+wind|wind\s+turbine|^wind$/i,    "wind"],
  [/solar|photovoltaic|pv/i,                   "solar"],
  [/natural\s+gas|combined\s+cycle|combustion\s+turbine|ng\b/i, "natural_gas"],
  [/coal|steam\s+turbine.*coal/i,              "coal"],
  [/hydro(electric)?|conventional\s+hydro/i,   "hydro"],
  [/petroleum|oil|diesel|residual\s+fuel/i,    "oil"],
  [/geothermal/i,                              "geothermal"],
  [/biomass|wood\s+waste|agricultural|landfill\s+gas/i, "biomass"],
  [/battery|storage|flywheel|compressed\s+air/i, "other_renewable"],
];

export function mapFuelType(
  energySourceCode: string | null | undefined,
  technology: string | null | undefined
): GeneratorFuelType {
  if (energySourceCode) {
    const mapped = ENERGY_SOURCE_FUEL_MAP[energySourceCode.trim().toUpperCase()];
    if (mapped) return mapped;
  }

  if (technology) {
    for (const [re, fuel] of TECHNOLOGY_FUEL_REGEXES) {
      if (re.test(technology)) return fuel;
    }
  }

  return "other";
}

// ── Status mapping ────────────────────────────────────────────────────────────
//
// EIA unit status codes (Form 860, Schedule 3, column AO):
//   OP  = Operating
//   SB  = Standby/Backup: same site, not normally used
//   OA  = Out of service: expected return date in the future
//   OS  = Out of service: no expected return date
//   RE  = Retired: permanently shut down
//   IP  = Indefinitely postponed: no current construction activity
//   P   = Planned: not under construction; regulatory approvals received
//   T   = Under construction: more than 50% complete
//   V   = Under construction: less than or equal to 50% complete
//   L   = Under construction: regulatory approvals not received, not under construction
//   CN  = Canceled or postponed indefinitely

const STATUS_CODE_MAP: Record<string, GeneratorStatus> = {
  OP: "operating",
  SB: "standby",
  OA: "out_of_service",
  OS: "out_of_service",
  RE: "retired",
  IP: "proposed",
  P:  "proposed",
  T:  "proposed",
  V:  "proposed",
  L:  "proposed",
  U:  "proposed",   // Under construction (generic)
  CN: "canceled",
};

export function mapGeneratorStatus(
  statusCode: string | null | undefined
): GeneratorStatus {
  if (!statusCode) return "other";
  const mapped = STATUS_CODE_MAP[statusCode.trim().toUpperCase()];
  return mapped ?? "other";
}

// ── Numeric parsing ───────────────────────────────────────────────────────────

export function parseCapacityMw(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/,/g, ""));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100; // round to 2 decimal places
}

/** Parse a geographic coordinate (latitude or longitude). Accepts negative values. */
export function parseNullableFloat(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!isFinite(n)) return null;
  return Math.round(n * 1_000_000) / 1_000_000; // 6 decimal places ≈ 0.1 m precision
}

export function parseYear(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (isNaN(n) || n < 1900 || n > 2100) return null;
  return n;
}

export function parseMonth(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (isNaN(n) || n < 1 || n > 12) return null;
  return n;
}
