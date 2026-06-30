/**
 * EIA Form 860 Generator Inventory — TypeScript types (INFRA-006)
 *
 * DB ↔ domain mapper pattern follows the same convention as types-network.ts
 * and types-queue.ts: snake_case for DB rows, camelCase for domain objects.
 */

// ── ENUM types (mirror the SQL ENUMs in migration 017) ───────────────────────

export const GENERATOR_STATUSES = [
  "operating",
  "standby",
  "out_of_service",
  "retired",
  "proposed",
  "canceled",
  "other",
] as const;

export type GeneratorStatus = (typeof GENERATOR_STATUSES)[number];

export const GENERATOR_FUEL_TYPES = [
  "natural_gas",
  "coal",
  "nuclear",
  "wind",
  "solar",
  "hydro",
  "oil",
  "geothermal",
  "biomass",
  "other_renewable",
  "other",
] as const;

export type GeneratorFuelType = (typeof GENERATOR_FUEL_TYPES)[number];

// ── Set-based O(1) validators ─────────────────────────────────────────────────

const VALID_STATUSES = new Set<string>(GENERATOR_STATUSES);
const VALID_FUEL_TYPES = new Set<string>(GENERATOR_FUEL_TYPES);

export function isValidGeneratorStatus(v: unknown): v is GeneratorStatus {
  return typeof v === "string" && VALID_STATUSES.has(v);
}

export function isValidGeneratorFuelType(v: unknown): v is GeneratorFuelType {
  return typeof v === "string" && VALID_FUEL_TYPES.has(v);
}

// ── DB row types (snake_case, mirrors Postgres columns) ───────────────────────

export interface DbEiaGenerator {
  id: string;
  tenant_id: string;
  plant_id: string;
  generator_id: string;
  plant_name: string;
  data_year: number;
  state_abbr: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  balancing_authority: string | null;
  nameplate_mw: number | null;
  summer_mw: number | null;
  winter_mw: number | null;
  fuel_type: GeneratorFuelType;
  prime_mover: string | null;
  energy_source_code: string | null;
  technology: string | null;
  operational_status: GeneratorStatus;
  operating_year: number | null;
  operating_month: number | null;
  retirement_year: number | null;
  retirement_month: number | null;
  utility_id: string | null;
  utility_name: string | null;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

/** Insert type: omit server-generated fields */
export type DbEiaGeneratorInsert = Omit<
  DbEiaGenerator,
  "id" | "created_at" | "updated_at"
>;

// ── Domain type (camelCase, used in application layer) ────────────────────────

export interface EiaGenerator {
  id: string;
  tenantId: string;
  plantId: string;
  generatorId: string;
  plantName: string;
  dataYear: number;
  stateAbbr: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  balancingAuthority: string | null;
  nameplateMw: number | null;
  summerMw: number | null;
  winterMw: number | null;
  fuelType: GeneratorFuelType;
  primeMover: string | null;
  energySourceCode: string | null;
  technology: string | null;
  operationalStatus: GeneratorStatus;
  operatingYear: number | null;
  operatingMonth: number | null;
  retirementYear: number | null;
  retirementMonth: number | null;
  utilityId: string | null;
  utilityName: string | null;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Aggregated capacity summary for a balancing authority */
export interface CapacitySummaryByFuel {
  balancingAuthority: string;
  dataYear: number;
  totalMw: number;
  operatingMw: number;
  byFuelType: Partial<Record<GeneratorFuelType, number>>;
  generatorCount: number;
  operatingCount: number;
}

// ── Row → domain mapper ───────────────────────────────────────────────────────

export function toEiaGenerator(row: DbEiaGenerator): EiaGenerator {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    plantId: row.plant_id,
    generatorId: row.generator_id,
    plantName: row.plant_name,
    dataYear: Number(row.data_year),
    stateAbbr: row.state_abbr,
    county: row.county,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    balancingAuthority: row.balancing_authority,
    nameplateMw: row.nameplate_mw != null ? Number(row.nameplate_mw) : null,
    summerMw: row.summer_mw != null ? Number(row.summer_mw) : null,
    winterMw: row.winter_mw != null ? Number(row.winter_mw) : null,
    fuelType: row.fuel_type,
    primeMover: row.prime_mover,
    energySourceCode: row.energy_source_code,
    technology: row.technology,
    operationalStatus: row.operational_status,
    operatingYear: row.operating_year != null ? Number(row.operating_year) : null,
    operatingMonth: row.operating_month != null ? Number(row.operating_month) : null,
    retirementYear: row.retirement_year != null ? Number(row.retirement_year) : null,
    retirementMonth: row.retirement_month != null ? Number(row.retirement_month) : null,
    utilityId: row.utility_id,
    utilityName: row.utility_name,
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export class EiaGeneratorValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = "EiaGeneratorValidationError";
  }
}

export function validateEiaGeneratorInsert(
  insert: DbEiaGeneratorInsert
): void {
  if (!insert.plant_id || insert.plant_id.trim().length === 0) {
    throw new EiaGeneratorValidationError(
      "plant_id is required",
      "plant_id"
    );
  }
  if (!insert.generator_id || insert.generator_id.trim().length === 0) {
    throw new EiaGeneratorValidationError(
      "generator_id is required",
      "generator_id"
    );
  }
  if (!insert.plant_name || insert.plant_name.trim().length === 0) {
    throw new EiaGeneratorValidationError(
      "plant_name is required",
      "plant_name"
    );
  }
  const year = insert.data_year;
  if (!year || year < 1950 || year > 2100) {
    throw new EiaGeneratorValidationError(
      "data_year must be a plausible calendar year (1950–2100)",
      "data_year"
    );
  }
  if (!isValidGeneratorFuelType(insert.fuel_type)) {
    throw new EiaGeneratorValidationError(
      `fuel_type "${insert.fuel_type}" is not a valid GeneratorFuelType`,
      "fuel_type"
    );
  }
  if (!isValidGeneratorStatus(insert.operational_status)) {
    throw new EiaGeneratorValidationError(
      `operational_status "${insert.operational_status}" is not a valid GeneratorStatus`,
      "operational_status"
    );
  }
  if (
    insert.nameplate_mw != null &&
    (insert.nameplate_mw < 0 || !isFinite(insert.nameplate_mw))
  ) {
    throw new EiaGeneratorValidationError(
      "nameplate_mw must be non-negative",
      "nameplate_mw"
    );
  }
  if (
    insert.operating_month != null &&
    (insert.operating_month < 1 || insert.operating_month > 12)
  ) {
    throw new EiaGeneratorValidationError(
      "operating_month must be 1–12",
      "operating_month"
    );
  }
  if (
    insert.retirement_month != null &&
    (insert.retirement_month < 1 || insert.retirement_month > 12)
  ) {
    throw new EiaGeneratorValidationError(
      "retirement_month must be 1–12",
      "retirement_month"
    );
  }
}
