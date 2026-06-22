"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronUp, ChevronDown, Minus, RotateCcw, Save, Trash2, Zap } from "lucide-react";
import {
  assessSubstationCapacity,
  forecastTransformerOverload,
  getSeverityLabel,
  type SubstationCapacityResult,
  type TransformerOverloadResult,
  type ConstraintSeverity,
} from "@/lib/planning-engine";
import {
  substationPortfolio,
  loadGrowthAssumptions,
  planningTerritory,
} from "@/lib/enterprise-data";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScenarioInputs {
  dataCenterLoadMW: number;
  evGrowthPct: number;
  populationGrowthPct: number;
  commercialGrowthPct: number;
}

interface Scenario {
  id: string;
  name: string;
  inputs: ScenarioInputs;
  createdAt: string;
}

const BASELINE: ScenarioInputs = {
  dataCenterLoadMW: loadGrowthAssumptions.dataCenterQueueMW,
  evGrowthPct: loadGrowthAssumptions.evPenetrationGrowthPct,
  populationGrowthPct: loadGrowthAssumptions.populationGrowthPct,
  commercialGrowthPct: loadGrowthAssumptions.commercialGrowthPct,
};

// ── Computation ───────────────────────────────────────────────────────────────

function compositeGrowthRate(ev: number, pop: number, comm: number): number {
  return ev * 0.15 + pop * 0.40 + comm * 0.45;
}

function runScenario(inputs: ScenarioInputs) {
  const horizon = planningTerritory.planningHorizonYears;
  const totalCurrentLoad = substationPortfolio.reduce((s, ss) => s + ss.peakLoadMW, 0);
  const allTransformers = substationPortfolio.flatMap((ss) => ss.transformers);

  const baselineComposite = compositeGrowthRate(
    BASELINE.evGrowthPct, BASELINE.populationGrowthPct, BASELINE.commercialGrowthPct
  );
  const scenarioComposite = compositeGrowthRate(
    inputs.evGrowthPct, inputs.populationGrowthPct, inputs.commercialGrowthPct
  );
  const growthRatio = baselineComposite > 0 ? scenarioComposite / baselineComposite : 1;
  const dcDelta = inputs.dataCenterLoadMW - BASELINE.dataCenterLoadMW;

  // Substation results
  const substationRows = substationPortfolio.map((ss) => {
    const baseline = assessSubstationCapacity(ss, horizon, 0);
    const modifiedSS = { ...ss, annualGrowthPct: ss.annualGrowthPct * growthRatio };
    const additionalLoadMW = dcDelta * (ss.peakLoadMW / totalCurrentLoad);
    const scenario = assessSubstationCapacity(modifiedSS, horizon, additionalLoadMW);
    return { id: ss.id, name: ss.name, region: ss.region, baseline, scenario };
  });

  // Transformer results
  const txRows = allTransformers.map((tx) => {
    const ss = substationPortfolio.find((s) => s.id === tx.substationId)!;
    const baseline = forecastTransformerOverload(
      tx,
      BASELINE.evGrowthPct,
      BASELINE.dataCenterLoadMW / allTransformers.length
    );
    const scenario = forecastTransformerOverload(
      tx,
      inputs.evGrowthPct,
      inputs.dataCenterLoadMW / allTransformers.length
    );
    return { tx, ssName: ss.name, baseline, scenario };
  });

  // Aggregate KPIs
  const baselineTotalCapex = substationRows.reduce((s, r) => s + r.baseline.estimatedCapexM, 0);
  const scenarioTotalCapex = substationRows.reduce((s, r) => s + r.scenario.estimatedCapexM, 0);
  const baselineConstrained = substationRows.filter(
    (r) => r.baseline.severity === "constrained" || r.baseline.severity === "critical"
  ).length;
  const scenarioConstrained = substationRows.filter(
    (r) => r.scenario.severity === "constrained" || r.scenario.severity === "critical"
  ).length;
  const baselineMinYears = Math.min(
    ...substationRows.map((r) => r.baseline.yearsToConstraint ?? 999)
  );
  const scenarioMinYears = Math.min(
    ...substationRows.map((r) => r.scenario.yearsToConstraint ?? 999)
  );
  const baselineCriticalTx = txRows.filter(
    (r) => r.baseline.overloadRisk === "critical" || r.baseline.overloadRisk === "constrained"
  ).length;
  const scenarioCriticalTx = txRows.filter(
    (r) => r.scenario.overloadRisk === "critical" || r.scenario.overloadRisk === "constrained"
  ).length;

  return {
    substationRows,
    txRows,
    kpis: {
      baselineTotalCapex,
      scenarioTotalCapex,
      baselineConstrained,
      scenarioConstrained,
      baselineMinYears: baselineMinYears === 999 ? null : baselineMinYears,
      scenarioMinYears: scenarioMinYears === 999 ? null : scenarioMinYears,
      baselineCriticalTx,
      scenarioCriticalTx,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEV_BADGE: Record<ConstraintSeverity, string> = {
  normal:      "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  watch:       "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  constrained: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  critical:    "bg-red-500/15 text-red-400 border-red-500/30",
};

function SevBadge({ severity }: { severity: ConstraintSeverity }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEV_BADGE[severity]}`}>
      {getSeverityLabel(severity)}
    </span>
  );
}

function Delta({
  base,
  scenario,
  unit = "",
  higherIsBad = true,
  decimals = 1,
}: {
  base: number;
  scenario: number;
  unit?: string;
  higherIsBad?: boolean;
  decimals?: number;
}) {
  const diff = scenario - base;
  if (Math.abs(diff) < 0.05) {
    return <span className="flex items-center gap-0.5 text-muted-foreground"><Minus className="h-3 w-3" />—</span>;
  }
  const isWorse = higherIsBad ? diff > 0 : diff < 0;
  const color = isWorse ? "text-red-400" : "text-emerald-400";
  const Icon = diff > 0 ? ChevronUp : ChevronDown;
  return (
    <span className={`flex items-center gap-0.5 font-mono text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(diff).toFixed(decimals)}{unit}
    </span>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  description,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 font-mono text-sm focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

// ── KPI Comparison Strip ──────────────────────────────────────────────────────

function KpiComparison({ kpis }: { kpis: ReturnType<typeof runScenario>["kpis"] }) {
  const cards = [
    {
      label: "Constrained Substations",
      base: kpis.baselineConstrained,
      scenario: kpis.scenarioConstrained,
      unit: "",
      higherIsBad: true,
    },
    {
      label: "Transformers at Risk",
      base: kpis.baselineCriticalTx,
      scenario: kpis.scenarioCriticalTx,
      unit: "",
      higherIsBad: true,
    },
    {
      label: "Earliest Constraint",
      base: kpis.baselineMinYears ?? 999,
      scenario: kpis.scenarioMinYears ?? 999,
      unit: " yr",
      higherIsBad: false,
      display: (v: number) => v === 999 ? "—" : `${v.toFixed(1)} yr`,
    },
    {
      label: "Est. Priority CAPEX",
      base: kpis.baselineTotalCapex,
      scenario: kpis.scenarioTotalCapex,
      unit: "M",
      higherIsBad: true,
      display: (v: number) => `$${v.toFixed(1)}M`,
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => {
        const diff = card.scenario - card.base;
        const isWorse = card.higherIsBad ? diff > 0 : diff < 0;
        const isImproved = card.higherIsBad ? diff < 0 : diff > 0;
        return (
          <div
            key={card.label}
            className="rounded-lg border border-border/40 bg-[#0d1219]/80 p-4"
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{card.label}</p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground/60">Baseline</p>
                <p className="font-mono text-base font-bold text-muted-foreground">
                  {"display" in card ? card.display(card.base) : card.base}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground/60">Scenario</p>
                <p className={`font-mono text-lg font-bold ${isWorse ? "text-red-400" : isImproved ? "text-emerald-400" : ""}`}>
                  {"display" in card ? card.display(card.scenario) : card.scenario}
                </p>
              </div>
            </div>
            {Math.abs(diff) >= 0.05 && (
              <div className={`mt-2 text-[10px] font-medium ${isWorse ? "text-red-400" : "text-emerald-400"}`}>
                {isWorse ? "▲ Worse" : "▼ Improved"} by{" "}
                {"display" in card
                  ? `${Math.abs(diff).toFixed(1)}${card.unit}`
                  : Math.abs(diff)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Substation Comparison Table ───────────────────────────────────────────────

function SubstationTable({
  rows,
}: {
  rows: ReturnType<typeof runScenario>["substationRows"];
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-[#0d1219]/80">
      <div className="border-b border-border/40 px-5 py-4">
        <h2 className="text-sm font-semibold">Substation Capacity</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Utilization, N-1 headroom, years to constraint, and CAPEX — Baseline vs Scenario</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead>
            <tr className="border-b border-border/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-5 py-3 text-left font-medium">Substation</th>
              <th className="px-3 py-3 text-right font-medium">Utilization</th>
              <th className="px-3 py-3 text-right font-medium">Δ</th>
              <th className="px-3 py-3 text-right font-medium">N-1 Headroom</th>
              <th className="px-3 py-3 text-right font-medium">Δ</th>
              <th className="px-3 py-3 text-center font-medium">Status</th>
              <th className="px-3 py-3 text-right font-medium">Yrs to Limit</th>
              <th className="px-3 py-3 text-right font-medium">Δ</th>
              <th className="px-5 py-3 text-right font-medium">CAPEX ($M)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {rows.map((row) => {
              const sevChanged = row.baseline.severity !== row.scenario.severity;
              return (
                <tr key={row.id} className="group hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <p className="font-medium text-foreground">{row.name}</p>
                    <p className="text-[10px] text-muted-foreground">{row.region}</p>
                  </td>
                  {/* Utilization */}
                  <td className="px-3 py-3 text-right">
                    <span className="text-muted-foreground">{row.baseline.utilizationPct.toFixed(1)}%</span>
                    <span className="mx-1 text-muted-foreground/40">→</span>
                    <span className={row.scenario.utilizationPct > row.baseline.utilizationPct ? "text-red-400" : "text-emerald-400"}>
                      {row.scenario.utilizationPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Delta base={row.baseline.utilizationPct} scenario={row.scenario.utilizationPct} unit="%" />
                  </td>
                  {/* N-1 Headroom */}
                  <td className="px-3 py-3 text-right">
                    <span className="text-muted-foreground">{row.baseline.n1HeadroomMW.toFixed(0)} MW</span>
                    <span className="mx-1 text-muted-foreground/40">→</span>
                    <span className={row.scenario.n1HeadroomMW < row.baseline.n1HeadroomMW ? "text-red-400" : "text-emerald-400"}>
                      {row.scenario.n1HeadroomMW.toFixed(0)} MW
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Delta base={row.baseline.n1HeadroomMW} scenario={row.scenario.n1HeadroomMW} unit=" MW" higherIsBad={false} />
                  </td>
                  {/* Status */}
                  <td className="px-3 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {sevChanged ? (
                        <>
                          <SevBadge severity={row.baseline.severity} />
                          <span className="text-[9px] text-muted-foreground">→</span>
                          <SevBadge severity={row.scenario.severity} />
                        </>
                      ) : (
                        <SevBadge severity={row.scenario.severity} />
                      )}
                    </div>
                  </td>
                  {/* Years to Constraint */}
                  <td className="px-3 py-3 text-right font-mono">
                    <span className="text-muted-foreground">
                      {row.baseline.yearsToConstraint !== null ? `${row.baseline.yearsToConstraint}y` : "—"}
                    </span>
                    <span className="mx-1 text-muted-foreground/40">→</span>
                    <span className={
                      row.scenario.yearsToConstraint !== null && row.baseline.yearsToConstraint !== null
                        ? row.scenario.yearsToConstraint < row.baseline.yearsToConstraint
                          ? "text-red-400"
                          : "text-emerald-400"
                        : ""
                    }>
                      {row.scenario.yearsToConstraint !== null ? `${row.scenario.yearsToConstraint}y` : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {row.baseline.yearsToConstraint !== null && row.scenario.yearsToConstraint !== null ? (
                      <Delta
                        base={row.baseline.yearsToConstraint}
                        scenario={row.scenario.yearsToConstraint}
                        unit="y"
                        higherIsBad={false}
                      />
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  {/* CAPEX */}
                  <td className="px-5 py-3 text-right font-mono">
                    <span className="text-muted-foreground">
                      {row.baseline.estimatedCapexM > 0 ? `$${row.baseline.estimatedCapexM.toFixed(1)}M` : "—"}
                    </span>
                    {row.scenario.estimatedCapexM !== row.baseline.estimatedCapexM && (
                      <>
                        <span className="mx-1 text-muted-foreground/40">→</span>
                        <span className={row.scenario.estimatedCapexM > row.baseline.estimatedCapexM ? "text-red-400" : "text-emerald-400"}>
                          {row.scenario.estimatedCapexM > 0 ? `$${row.scenario.estimatedCapexM.toFixed(1)}M` : "—"}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Transformer Risk Table ────────────────────────────────────────────────────

function TransformerTable({
  rows,
}: {
  rows: ReturnType<typeof runScenario>["txRows"];
}) {
  const sorted = [...rows].sort(
    (a, b) => b.scenario.replacementPriority - a.scenario.replacementPriority
  );

  return (
    <div className="rounded-lg border border-border/40 bg-[#0d1219]/80">
      <div className="border-b border-border/40 px-5 py-4">
        <h2 className="text-sm font-semibold">Transformer Overload Risk</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Forecast loading under scenario growth — sorted by replacement priority</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-xs">
          <thead>
            <tr className="border-b border-border/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-5 py-3 text-left font-medium">Transformer</th>
              <th className="px-3 py-3 text-right font-medium">Current Load%</th>
              <th className="px-3 py-3 text-right font-medium">Forecast Load%</th>
              <th className="px-3 py-3 text-right font-medium">Δ</th>
              <th className="px-3 py-3 text-center font-medium">Risk</th>
              <th className="px-5 py-3 text-right font-medium">Priority Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {sorted.map(({ tx, ssName, baseline, scenario }) => {
              const riskChanged = baseline.overloadRisk !== scenario.overloadRisk;
              return (
                <tr key={tx.id} className="hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <p className="font-medium">{tx.name}</p>
                    <p className="text-[10px] text-muted-foreground">{ssName}</p>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-muted-foreground">
                    {scenario.loadingPct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-3 text-right font-mono">
                    <span className="text-muted-foreground">{baseline.forecastLoadingPct.toFixed(1)}%</span>
                    <span className="mx-1 text-muted-foreground/40">→</span>
                    <span className={scenario.forecastLoadingPct > baseline.forecastLoadingPct ? "text-red-400" : "text-emerald-400"}>
                      {scenario.forecastLoadingPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Delta base={baseline.forecastLoadingPct} scenario={scenario.forecastLoadingPct} unit="%" />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {riskChanged ? (
                        <>
                          <SevBadge severity={baseline.overloadRisk} />
                          <span className="text-[9px] text-muted-foreground">→</span>
                          <SevBadge severity={scenario.overloadRisk} />
                        </>
                      ) : (
                        <SevBadge severity={scenario.overloadRisk} />
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border/40">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(100, scenario.replacementPriority)}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono">{scenario.replacementPriority}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Action Summary ────────────────────────────────────────────────────────────

function ActionSummary({
  rows,
}: {
  rows: ReturnType<typeof runScenario>["substationRows"];
}) {
  const actionable = rows.filter(
    (r) => r.scenario.severity === "constrained" || r.scenario.severity === "critical"
  );
  if (actionable.length === 0) return null;

  return (
    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5">
      <div className="border-b border-yellow-500/20 px-5 py-4">
        <h2 className="text-sm font-semibold text-yellow-400">Recommended Actions Under This Scenario</h2>
      </div>
      <ul className="divide-y divide-yellow-500/10">
        {actionable.map((row) => (
          <li key={row.id} className="px-5 py-3">
            <div className="flex items-start gap-3">
              <SevBadge severity={row.scenario.severity} />
              <div>
                <p className="text-xs font-medium">{row.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{row.scenario.recommendedAction}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ScenarioPage() {
  const [inputs, setInputs] = useState<ScenarioInputs>(BASELINE);

  // ── Persistence state ────────────────────────────────────────────────────────
  const [saved, setSaved] = useState<Scenario[]>([]);
  const [dbAvailable, setDbAvailable] = useState<boolean | null>(null); // null = loading
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/scenarios");
      if (!res.ok) { setDbAvailable(false); return; }
      const data: Scenario[] = await res.json();
      setSaved(data);
      setDbAvailable(true);
    } catch {
      setDbAvailable(false);
    }
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  useEffect(() => {
    if (saveOpen) setTimeout(() => saveInputRef.current?.focus(), 50);
  }, [saveOpen]);

  async function handleSave() {
    if (!saveName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), inputs }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        setSaveError(err.error ?? "Save failed");
        return;
      }
      setSaveName("");
      setSaveOpen(false);
      await loadSaved();
    } catch {
      setSaveError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/scenarios/${id}`, { method: "DELETE" });
      await loadSaved();
    } finally {
      setDeletingId(null);
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const results = useMemo(() => runScenario(inputs), [inputs]);

  const isBaseline =
    inputs.dataCenterLoadMW === BASELINE.dataCenterLoadMW &&
    inputs.evGrowthPct === BASELINE.evGrowthPct &&
    inputs.populationGrowthPct === BASELINE.populationGrowthPct &&
    inputs.commercialGrowthPct === BASELINE.commercialGrowthPct;

  function set(key: keyof ScenarioInputs) {
    return (v: number) => setInputs((prev) => ({ ...prev, [key]: v }));
  }

  return (
    <div className="flex min-h-screen bg-[#070b12] text-foreground">
      {/* Sidebar — inputs */}
      <aside className="sticky top-0 flex h-screen w-72 shrink-0 flex-col border-r border-border/40 bg-[#0a0f18] overflow-y-auto">
        {/* Header */}
        <div className="border-b border-border/40 p-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/30">
              <Zap className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-sm font-semibold">GridVision AI</span>
          </Link>
          <div className="mt-3">
            <Link
              href="/enterprise"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Enterprise Planning
            </Link>
            <h1 className="mt-1 text-base font-bold">Scenario Planning</h1>
          </div>
        </div>

        {/* Scenario tag */}
        <div className="border-b border-border/40 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-widest ${isBaseline ? "bg-slate-500/15 text-slate-400" : "bg-primary/15 text-primary"}`}>
              {isBaseline ? "BASELINE" : "MODIFIED"}
            </span>
            {!isBaseline && (
              <button
                type="button"
                onClick={() => setInputs(BASELINE)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                Reset
              </button>
            )}
          </div>
          {!isBaseline && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Adjustments relative to {planningTerritory.planningHorizonYears}-year baseline
            </p>
          )}
        </div>

        {/* Form */}
        <div className="flex-1 space-y-6 p-4">
          <NumberInput
            label="Data Center Queue"
            value={inputs.dataCenterLoadMW}
            onChange={set("dataCenterLoadMW")}
            min={0}
            max={1000}
            step={10}
            unit="MW"
            description={`Baseline: ${BASELINE.dataCenterLoadMW} MW`}
          />
          <NumberInput
            label="EV Penetration Growth"
            value={inputs.evGrowthPct}
            onChange={set("evGrowthPct")}
            min={0}
            max={50}
            step={0.5}
            unit="%/yr"
            description={`Baseline: ${BASELINE.evGrowthPct}%`}
          />
          <NumberInput
            label="Population Growth"
            value={inputs.populationGrowthPct}
            onChange={set("populationGrowthPct")}
            min={0}
            max={10}
            step={0.1}
            unit="%/yr"
            description={`Baseline: ${BASELINE.populationGrowthPct}%`}
          />
          <NumberInput
            label="Commercial Growth"
            value={inputs.commercialGrowthPct}
            onChange={set("commercialGrowthPct")}
            min={0}
            max={15}
            step={0.1}
            unit="%/yr"
            description={`Baseline: ${BASELINE.commercialGrowthPct}%`}
          />
        </div>

        {/* Save / Saved Scenarios */}
        {dbAvailable !== false && (
          <div className="border-t border-border/40">
            {/* Save button row */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" />
                Saved Scenarios
              </div>
              <button
                type="button"
                onClick={() => { setSaveOpen((o) => !o); setSaveError(null); }}
                className="flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] font-medium hover:bg-accent/50"
              >
                <Save className="h-3 w-3" />
                Save
              </button>
            </div>

            {/* Inline save form */}
            {saveOpen && (
              <div className="border-t border-border/30 px-4 py-3 space-y-2">
                <input
                  ref={saveInputRef}
                  type="text"
                  placeholder="Scenario name…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setSaveOpen(false); }}
                  className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  maxLength={80}
                />
                {saveError && <p className="text-[10px] text-red-400">{saveError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !saveName.trim()}
                    className="flex-1 rounded-md bg-primary/90 px-2 py-1.5 text-[10px] font-semibold text-primary-foreground hover:bg-primary disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save Scenario"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSaveOpen(false); setSaveError(null); }}
                    className="rounded-md border border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-accent/50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Saved list */}
            {dbAvailable === null && (
              <p className="px-4 pb-3 text-[10px] text-muted-foreground">Loading…</p>
            )}
            {dbAvailable === true && saved.length === 0 && !saveOpen && (
              <p className="px-4 pb-3 text-[10px] text-muted-foreground">No saved scenarios yet.</p>
            )}
            {saved.length > 0 && (
              <ul className="divide-y divide-border/20 border-t border-border/30">
                {saved.map((s) => (
                  <li key={s.id} className="group flex items-start justify-between gap-2 px-4 py-2.5 hover:bg-white/[0.02]">
                    <button
                      type="button"
                      onClick={() => setInputs(s.inputs)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-xs font-medium group-hover:text-primary">{s.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      aria-label="Delete scenario"
                      className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Footer note */}
        <div className="border-t border-border/40 p-4">
          <p className="text-[10px] text-muted-foreground">
            Results update in real-time using the GridVision planning engine.
            Growth weights: EV 15% · Population 40% · Commercial 45%.
          </p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border/40 bg-[#0a0f18]/80 px-6 backdrop-blur-sm">
          <div>
            <p className="text-sm font-medium">
              {isBaseline ? "Baseline Projection" : "Scenario vs Baseline"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {planningTerritory.operatingCompany} · {planningTerritory.planningHorizonYears}-Year Horizon
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Composite growth:{" "}
              <span className="font-mono text-foreground">
                {compositeGrowthRate(inputs.evGrowthPct, inputs.populationGrowthPct, inputs.commercialGrowthPct).toFixed(2)}%
              </span>
              {!isBaseline && (
                <span className={`ml-1 ${compositeGrowthRate(inputs.evGrowthPct, inputs.populationGrowthPct, inputs.commercialGrowthPct) > compositeGrowthRate(BASELINE.evGrowthPct, BASELINE.populationGrowthPct, BASELINE.commercialGrowthPct) ? "text-red-400" : "text-emerald-400"}`}>
                  (baseline: {compositeGrowthRate(BASELINE.evGrowthPct, BASELINE.populationGrowthPct, BASELINE.commercialGrowthPct).toFixed(2)}%)
                </span>
              )}
            </span>
          </div>
        </header>

        {/* Results */}
        <main className="flex-1 space-y-6 overflow-auto p-6">
          {/* KPI comparison */}
          <KpiComparison kpis={results.kpis} />

          {/* Substation comparison table */}
          <SubstationTable rows={results.substationRows} />

          {/* Transformer risk */}
          <TransformerTable rows={results.txRows} />

          {/* Recommended actions for constrained/critical scenario substations */}
          <ActionSummary rows={results.substationRows} />
        </main>
      </div>
    </div>
  );
}
