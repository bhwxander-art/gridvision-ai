/**
 * Database row types for time-series hypertables (migration 014).
 *
 * These are append-only tables — there are no update operations.
 * Rows are inserted by ingestion pipelines and read by algorithm services.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export type MeasurementType =
  | "voltage_mag_pu"
  | "voltage_ang_deg"
  | "active_power_mw"
  | "reactive_power_mvar"
  | "line_flow_mw"
  | "line_flow_mvar"
  | "frequency_hz"
  | "current_ka";

export type MeasurementQuality = 0 | 1 | 2 | 3; // good | suspect | bad | estimated

export type MarketType = "RT" | "DA";

export type FuelType =
  | "solar"
  | "wind"
  | "natural_gas"
  | "nuclear"
  | "hydro"
  | "coal"
  | "oil"
  | "geothermal"
  | "other";

export type CustomerType =
  | "residential"
  | "commercial"
  | "industrial"
  | "ev_charging";

// ── scada_readings ────────────────────────────────────────────────────────────

export interface DbScadaReading {
  ts: string;
  tenant_id: string;
  model_id: string | null;
  bus_id: string | null;
  branch_id: string | null;
  measurement_type: MeasurementType;
  value: number;
  quality: MeasurementQuality;
  source: string;
}

export interface DbScadaReadingInsert
  extends Omit<DbScadaReading, "model_id" | "bus_id" | "branch_id" | "quality" | "source"> {
  model_id?: string | null;
  bus_id?: string | null;
  branch_id?: string | null;
  quality?: MeasurementQuality;
  source?: string;
}

// ── lmp_prices ────────────────────────────────────────────────────────────────

export interface DbLmpPrice {
  ts: string;
  tenant_id: string;
  iso_id: string;
  bus_id: string | null;
  pnode_id: string;
  pnode_name: string | null;
  lmp_total: number;
  lmp_energy: number | null;
  lmp_congestion: number | null;
  lmp_loss: number | null;
  market_type: MarketType;
  interval_min: 5 | 15 | 60;
}

export interface DbLmpPriceInsert
  extends Omit<
    DbLmpPrice,
    "bus_id" | "pnode_name" | "lmp_energy" | "lmp_congestion" | "lmp_loss" | "market_type" | "interval_min"
  > {
  bus_id?: string | null;
  pnode_name?: string | null;
  lmp_energy?: number | null;
  lmp_congestion?: number | null;
  lmp_loss?: number | null;
  market_type?: MarketType;
  interval_min?: 5 | 15 | 60;
}

export interface DbLmpHourly {
  bucket: string;
  tenant_id: string;
  iso_id: string;
  pnode_id: string;
  market_type: MarketType;
  lmp_avg: number;
  lmp_min: number;
  lmp_max: number;
  sample_count: number;
}

// ── generator_output ──────────────────────────────────────────────────────────

export interface DbGeneratorOutput {
  ts: string;
  tenant_id: string;
  iso_id: string;
  generator_id: string;
  generator_name: string | null;
  bus_id: string | null;
  fuel_type: FuelType;
  output_mw: number;
  scheduled_mw: number | null;
  capacity_mw: number | null;
  source: string;
  interval_min: number;
}

export interface DbGeneratorOutputInsert
  extends Omit<
    DbGeneratorOutput,
    "generator_name" | "bus_id" | "scheduled_mw" | "capacity_mw" | "source" | "interval_min"
  > {
  generator_name?: string | null;
  bus_id?: string | null;
  scheduled_mw?: number | null;
  capacity_mw?: number | null;
  source?: string;
  interval_min?: number;
}

// ── weather_observations ──────────────────────────────────────────────────────

export interface DbWeatherObservation {
  ts: string;
  tenant_id: string;
  station_id: string;
  station_name: string | null;
  latitude: number;
  longitude: number;
  temp_c: number | null;
  wind_speed_ms: number | null;
  wind_dir_deg: number | null;
  solar_irr_wm2: number | null;
  precip_mm: number | null;
  humidity_pct: number | null;
  pressure_hpa: number | null;
  forecast_horizon_h: number | null;
  model_run_ts: string | null;
  source: string;
}

export interface DbWeatherObservationInsert
  extends Omit<
    DbWeatherObservation,
    | "station_name"
    | "temp_c"
    | "wind_speed_ms"
    | "wind_dir_deg"
    | "solar_irr_wm2"
    | "precip_mm"
    | "humidity_pct"
    | "pressure_hpa"
    | "forecast_horizon_h"
    | "model_run_ts"
  > {
  station_name?: string | null;
  temp_c?: number | null;
  wind_speed_ms?: number | null;
  wind_dir_deg?: number | null;
  solar_irr_wm2?: number | null;
  precip_mm?: number | null;
  humidity_pct?: number | null;
  pressure_hpa?: number | null;
  forecast_horizon_h?: number | null;
  model_run_ts?: string | null;
}

// ── ami_interval_data ─────────────────────────────────────────────────────────

export interface DbAmiInterval {
  ts: string;
  tenant_id: string;
  meter_id: string;
  feeder_id: string | null;
  substation_id: string | null;
  zip_code: string | null;
  energy_kwh: number;
  demand_kw: number | null;
  voltage_v: number | null;
  customer_type: CustomerType;
}

export interface DbAmiIntervalInsert
  extends Omit<
    DbAmiInterval,
    "feeder_id" | "substation_id" | "zip_code" | "demand_kw" | "voltage_v" | "customer_type"
  > {
  feeder_id?: string | null;
  substation_id?: string | null;
  zip_code?: string | null;
  demand_kw?: number | null;
  voltage_v?: number | null;
  customer_type?: CustomerType;
}

// ── Validation helpers ────────────────────────────────────────────────────────

export class TimeSeriesValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = "TimeSeriesValidationError";
  }
}

const VALID_MEASUREMENT_TYPES = new Set<MeasurementType>([
  "voltage_mag_pu",
  "voltage_ang_deg",
  "active_power_mw",
  "reactive_power_mvar",
  "line_flow_mw",
  "line_flow_mvar",
  "frequency_hz",
  "current_ka",
]);

const VALID_FUEL_TYPES = new Set<FuelType>([
  "solar", "wind", "natural_gas", "nuclear", "hydro",
  "coal", "oil", "geothermal", "other",
]);

const VALID_CUSTOMER_TYPES = new Set<CustomerType>([
  "residential", "commercial", "industrial", "ev_charging",
]);

export function validateScadaReading(r: DbScadaReadingInsert): void {
  if (!r.ts) throw new TimeSeriesValidationError("ts is required", "ts");
  if (!VALID_MEASUREMENT_TYPES.has(r.measurement_type)) {
    throw new TimeSeriesValidationError(
      `Unknown measurement_type: ${r.measurement_type}`,
      "measurement_type"
    );
  }
  if (!isFinite(r.value)) {
    throw new TimeSeriesValidationError(
      "value must be a finite number",
      "value"
    );
  }
  const quality = r.quality ?? 0;
  if (quality < 0 || quality > 3) {
    throw new TimeSeriesValidationError(
      "quality must be 0-3",
      "quality"
    );
  }
}

export function validateLmpPrice(p: DbLmpPriceInsert): void {
  if (!p.ts) throw new TimeSeriesValidationError("ts is required", "ts");
  if (!p.pnode_id?.trim()) {
    throw new TimeSeriesValidationError("pnode_id is required", "pnode_id");
  }
  if (!isFinite(p.lmp_total)) {
    throw new TimeSeriesValidationError(
      "lmp_total must be a finite number",
      "lmp_total"
    );
  }
  if (!["RT", "DA"].includes(p.market_type ?? "RT")) {
    throw new TimeSeriesValidationError(
      "market_type must be RT or DA",
      "market_type"
    );
  }
}

export function validateGeneratorOutput(g: DbGeneratorOutputInsert): void {
  if (!g.ts) throw new TimeSeriesValidationError("ts is required", "ts");
  if (!g.generator_id?.trim()) {
    throw new TimeSeriesValidationError(
      "generator_id is required",
      "generator_id"
    );
  }
  if (!VALID_FUEL_TYPES.has(g.fuel_type)) {
    throw new TimeSeriesValidationError(
      `Unknown fuel_type: ${g.fuel_type}`,
      "fuel_type"
    );
  }
  if (!isFinite(g.output_mw)) {
    throw new TimeSeriesValidationError(
      "output_mw must be a finite number",
      "output_mw"
    );
  }
}

export function validateAmiInterval(a: DbAmiIntervalInsert): void {
  if (!a.ts) throw new TimeSeriesValidationError("ts is required", "ts");
  if (!a.meter_id?.trim()) {
    throw new TimeSeriesValidationError("meter_id is required", "meter_id");
  }
  if (a.energy_kwh < 0) {
    throw new TimeSeriesValidationError(
      "energy_kwh must be non-negative",
      "energy_kwh"
    );
  }
  if (!VALID_CUSTOMER_TYPES.has(a.customer_type ?? "residential")) {
    throw new TimeSeriesValidationError(
      `Unknown customer_type: ${a.customer_type}`,
      "customer_type"
    );
  }
}

// ── Domain types ──────────────────────────────────────────────────────────────

export interface ScadaReading {
  ts: Date;
  tenantId: string;
  modelId: string | null;
  busId: string | null;
  branchId: string | null;
  measurementType: MeasurementType;
  value: number;
  quality: MeasurementQuality;
  source: string;
}

export interface LmpPrice {
  ts: Date;
  tenantId: string;
  isoId: string;
  busId: string | null;
  pnodeId: string;
  pnodeName: string | null;
  lmpTotal: number;
  lmpEnergy: number | null;
  lmpCongestion: number | null;
  lmpLoss: number | null;
  marketType: MarketType;
  intervalMin: 5 | 15 | 60;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

export function toScadaReading(row: DbScadaReading): ScadaReading {
  return {
    ts: new Date(row.ts),
    tenantId: row.tenant_id,
    modelId: row.model_id,
    busId: row.bus_id,
    branchId: row.branch_id,
    measurementType: row.measurement_type,
    value: Number(row.value),
    quality: row.quality as MeasurementQuality,
    source: row.source,
  };
}

export function toLmpPrice(row: DbLmpPrice): LmpPrice {
  return {
    ts: new Date(row.ts),
    tenantId: row.tenant_id,
    isoId: row.iso_id,
    busId: row.bus_id,
    pnodeId: row.pnode_id,
    pnodeName: row.pnode_name,
    lmpTotal: Number(row.lmp_total),
    lmpEnergy: row.lmp_energy != null ? Number(row.lmp_energy) : null,
    lmpCongestion:
      row.lmp_congestion != null ? Number(row.lmp_congestion) : null,
    lmpLoss: row.lmp_loss != null ? Number(row.lmp_loss) : null,
    marketType: row.market_type,
    intervalMin: row.interval_min,
  };
}
