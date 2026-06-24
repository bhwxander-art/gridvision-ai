import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

const id = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "IDs must be lowercase alphanumeric with hyphens");
const positiveNum = z.coerce.number().positive();
const nonNegNum   = z.coerce.number().min(0);
const pct100      = z.coerce.number().min(0).max(100);

// ── Substation ────────────────────────────────────────────────────────────────

export const SubstationCreateSchema = z.object({
  id:              id,
  name:            z.string().min(1).max(200),
  region:          z.string().min(1).max(100),
  voltageKV:       positiveNum,
  nameplateMVA:    positiveNum,
  peakLoadMW:      nonNegNum,
  n1CapacityMW:    positiveNum,
  annualGrowthPct: z.coerce.number().min(0).max(50),
  latitude:        z.coerce.number().min(-90).max(90),
  longitude:       z.coerce.number().min(-180).max(180),
});

export const SubstationPatchSchema = SubstationCreateSchema.omit({ id: true }).partial();

export type SubstationCreateInput = z.infer<typeof SubstationCreateSchema>;
export type SubstationPatchInput  = z.infer<typeof SubstationPatchSchema>;

// ── Transformer ───────────────────────────────────────────────────────────────

export const TransformerCreateSchema = z.object({
  id:            id,
  substationId:  id,
  name:          z.string().min(1).max(200),
  ratedMVA:      positiveNum,
  peakLoadMVA:   nonNegNum,
  loadFactor:    z.coerce.number().min(0).max(1),
  ageYears:      z.coerce.number().int().min(0).max(200),
  n1Compliant:   z.coerce.boolean(),
});

export const TransformerPatchSchema = TransformerCreateSchema.omit({ id: true }).partial();

export type TransformerCreateInput = z.infer<typeof TransformerCreateSchema>;
export type TransformerPatchInput  = z.infer<typeof TransformerPatchSchema>;

// ── Feeder ────────────────────────────────────────────────────────────────────

export const FeederCreateSchema = z.object({
  id:                 id,
  substationId:       id,
  name:               z.string().min(1).max(200),
  hostingCapacityMW:  positiveNum,
  committedLoadMW:    nonNegNum,
  queuedLoadMW:       nonNegNum,
});

export const FeederPatchSchema = FeederCreateSchema.omit({ id: true }).partial();

export type FeederCreateInput = z.infer<typeof FeederCreateSchema>;
export type FeederPatchInput  = z.infer<typeof FeederPatchSchema>;

// ── Capital Project ───────────────────────────────────────────────────────────

const UPGRADE_TYPES = [
  "transformer-replacement",
  "substation-expansion",
  "feeder-reconductor",
  "new-substation",
  "cable-replacement",
] as const;

const PROJECT_STATUSES = [
  "planned",
  "approved",
  "in-progress",
  "completed",
  "cancelled",
] as const;

export const CapitalProjectCreateSchema = z.object({
  id:                   id,
  substationId:         id,
  projectName:          z.string().min(1).max(300),
  upgradeType:          z.enum(UPGRADE_TYPES),
  estimatedCostUSD:     z.coerce.number().int().positive(),
  addedCapacityMW:      z.coerce.number().int().positive(),
  implementationMonths: z.coerce.number().int().positive(),
  riskReduction:        pct100,
  priorityScore:        pct100,
  status:               z.enum(PROJECT_STATUSES).default("planned"),
  notes:                z.string().max(2000).nullable().optional(),
});

export const CapitalProjectPatchSchema = CapitalProjectCreateSchema
  .omit({ id: true })
  .partial();

export type CapitalProjectCreateInput = z.infer<typeof CapitalProjectCreateSchema>;
export type CapitalProjectPatchInput  = z.infer<typeof CapitalProjectPatchSchema>;

// ── Shared API error format ───────────────────────────────────────────────────

export interface ApiError {
  error: string;
  details?: Record<string, string[]>;
}

export function zodErrorToApiError(err: z.ZodError): ApiError {
  const details: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const path = issue.path.join(".") || "_root";
    (details[path] ??= []).push(issue.message);
  }
  return { error: "Validation failed", details };
}
