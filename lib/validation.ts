import { z } from "zod";
import { NextResponse } from "next/server";

// ── Scenario schemas ───────────────────────────────────────────────────────

export const ScenarioInputsSchema = z.object({
  dataCenterLoadMW: z.number().nonnegative(),
  evGrowthPct: z.number(),
  populationGrowthPct: z.number(),
  commercialGrowthPct: z.number(),
});

export const SaveScenarioSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name must not be empty")
    .max(200, "name must be 200 characters or fewer"),
  inputs: ScenarioInputsSchema,
});

export type SaveScenarioBody = z.infer<typeof SaveScenarioSchema>;

// ── Validation helper ──────────────────────────────────────────────────────

export function validationError(issues: z.ZodIssue[]): NextResponse<{ error: string; details: string[] }> {
  const details = issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  return NextResponse.json(
    { error: "Validation failed", details },
    { status: 400 }
  );
}
