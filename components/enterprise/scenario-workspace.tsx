"use client";

import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BookmarkPlus,
  ChevronRight,
  FileBarChart,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CapacitySnapshot } from "@/lib/services/capacity.service";
import { simulateDataCenter } from "@/lib/services/capacity.service";
import type {
  CapacityImpactResponse,
  CopilotRiskLevel,
} from "@/app/api/copilot/capacity-impact/route";
import {
  useCapacityScenarios,
  type CapacityScenario,
  type CopilotRiskDisplay,
} from "@/lib/hooks/use-capacity-scenarios";

// ── Shared styling helpers ────────────────────────────────────────────────────

const RISK_COLOR: Record<CopilotRiskDisplay, string> = {
  LOW:      "text-emerald-400",
  MEDIUM:   "text-yellow-400",
  HIGH:     "text-orange-400",
  CRITICAL: "text-red-400",
};

const RISK_BADGE: Record<CopilotRiskDisplay, string> = {
  LOW:      "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  MEDIUM:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  HIGH:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
  CRITICAL: "bg-red-500/15 text-red-400 border-red-500/30",
};

function deriveCopilotRisk(pct: number): CopilotRiskDisplay {
  if (pct >= 90) return "CRITICAL";
  if (pct >= 75) return "HIGH";
  if (pct >= 60) return "MEDIUM";
  return "LOW";
}

// Normalize RiskLevel from capacity service → CopilotRiskDisplay
function normalizeRisk(level: string): CopilotRiskDisplay {
  const up = level.toUpperCase();
  if (up === "MODERATE") return "MEDIUM";
  if (up === "LOW" || up === "MEDIUM" || up === "HIGH" || up === "CRITICAL")
    return up as CopilotRiskDisplay;
  return "LOW";
}

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "hsl(222 47% 6%)",
    border: "1px solid hsl(217 33% 14%)",
    borderRadius: "8px",
    fontSize: "12px",
  },
  labelStyle: { color: "hsl(210 40% 98%)" },
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScenarioWorkspaceProps {
  baseline: CapacitySnapshot;
  currentMW: number;
  onLoadMW: (mw: number) => void;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ScenarioWorkspace({
  baseline,
  currentMW,
  onLoadMW,
}: ScenarioWorkspaceProps) {
  const store = useCapacityScenarios();
  const hasComparison = store.scenarioA !== null || store.scenarioB !== null;

  return (
    <div className="space-y-6">
      <ScenarioManagerCard
        baseline={baseline}
        currentMW={currentMW}
        onLoadMW={onLoadMW}
        store={store}
      />

      {hasComparison && (
        <ScenarioComparisonPanel
          baseline={baseline}
          scenarioA={store.scenarioA}
          scenarioB={store.scenarioB}
        />
      )}

      <ScenarioImpactChart baseline={baseline} currentMW={currentMW} />

      <ExecutiveSummaryCard addedMW={currentMW} />
    </div>
  );
}

// ── Scenario Manager Card ─────────────────────────────────────────────────────

function ScenarioManagerCard({
  baseline,
  currentMW,
  onLoadMW,
  store,
}: ScenarioWorkspaceProps & { store: ReturnType<typeof useCapacityScenarios> }) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (saveOpen) setTimeout(() => nameInputRef.current?.focus(), 50);
  }, [saveOpen]);

  useEffect(() => {
    if (renamingId) setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [renamingId]);

  function handleSave() {
    if (!saveName.trim()) return;
    const result = simulateDataCenter(baseline, currentMW);
    store.saveScenario(saveName, {
      addedMW:                currentMW,
      projectedUtilizationPct: result.utilizationPct,
      headroomMW:              result.remainingHeadroomMW,
      riskLevel:               deriveCopilotRisk(result.utilizationPct),
    });
    setSaveName("");
    setSaveOpen(false);
  }

  function handleRenameSubmit(id: string) {
    if (renameVal.trim()) store.renameScenario(id, renameVal);
    setRenamingId(null);
    setRenameVal("");
  }

  function startRename(s: CapacityScenario) {
    setRenamingId(s.id);
    setRenameVal(s.name);
  }

  const simResult = simulateDataCenter(baseline, currentMW);
  const currentRisk = deriveCopilotRisk(simResult.utilizationPct);

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileBarChart className="h-4 w-4 text-primary" />
            <CardTitle>Scenario Manager</CardTitle>
          </div>
          <CardDescription>
            Save, compare, and revisit capacity planning scenarios
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant={saveOpen ? "default" : "outline"}
          className="h-7 shrink-0 gap-1.5 border-border/40 bg-transparent text-xs"
          onClick={() => { setSaveOpen((o) => !o); setSaveName(""); }}
        >
          <BookmarkPlus className="h-3 w-3" />
          Save Scenario
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Current scenario snapshot */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/30 bg-background/30 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Current:</span>
          <span className="font-mono font-semibold">+{currentMW.toLocaleString()} MW</span>
          <span className="text-muted-foreground">→</span>
          <span className={`font-mono font-semibold ${RISK_COLOR[currentRisk]}`}>
            {simResult.utilizationPct}% utilization
          </span>
          <Badge variant="outline" className={`text-[10px] ${RISK_BADGE[currentRisk]}`}>
            {currentRisk}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {simResult.remainingHeadroomMW.toLocaleString()} MW headroom
          </span>
        </div>

        {/* Inline save form */}
        {saveOpen && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <Input
              ref={nameInputRef}
              placeholder="Scenario name…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setSaveOpen(false);
              }}
              className="h-8 border-border/40 bg-transparent text-sm"
              maxLength={80}
            />
            <Button
              size="sm"
              disabled={!saveName.trim()}
              onClick={handleSave}
              className="h-8 shrink-0"
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSaveOpen(false)}
              className="h-8 shrink-0 text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Saved list */}
        {store.scenarios.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No saved scenarios yet. Save the current simulation to begin comparing.
          </p>
        ) : (
          <div className="space-y-1.5">
            {store.scenarios.map((s) => {
              const isA = store.scenarioA?.id === s.id;
              const isB = store.scenarioB?.id === s.id;
              const isRenaming = renamingId === s.id;

              return (
                <div
                  key={s.id}
                  className="group flex items-center gap-2 rounded-lg border border-border/30 bg-background/20 px-3 py-2.5 hover:border-border/50"
                >
                  {isRenaming ? (
                    <Input
                      ref={renameInputRef}
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameSubmit(s.id);
                        if (e.key === "Escape") { setRenamingId(null); setRenameVal(""); }
                      }}
                      onBlur={() => handleRenameSubmit(s.id)}
                      className="h-7 flex-1 border-border/40 bg-transparent text-sm"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onLoadMW(s.addedMW)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="truncate text-sm font-medium group-hover:text-primary">
                        {s.name}
                      </span>
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                        +{s.addedMW} MW · {s.projectedUtilizationPct}%
                      </span>
                    </button>
                  )}

                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[9px] ${RISK_BADGE[s.riskLevel]}`}
                  >
                    {s.riskLevel}
                  </Badge>

                  {/* Slot buttons */}
                  <button
                    type="button"
                    onClick={() => store.assignSlot("A", isA ? null : s)}
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                      isA
                        ? "bg-blue-500/20 text-blue-400"
                        : "text-muted-foreground hover:bg-blue-500/10 hover:text-blue-400"
                    }`}
                    title="Set as Scenario A"
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => store.assignSlot("B", isB ? null : s)}
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                      isB
                        ? "bg-purple-500/20 text-purple-400"
                        : "text-muted-foreground hover:bg-purple-500/10 hover:text-purple-400"
                    }`}
                    title="Set as Scenario B"
                  >
                    B
                  </button>

                  {/* Rename */}
                  <button
                    type="button"
                    onClick={() => startRename(s)}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                    title="Rename"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => store.deleteScenario(s.id)}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {(store.scenarioA || store.scenarioB) && (
          <p className="text-[10px] text-muted-foreground">
            <span className="font-semibold text-blue-400">A</span> ={" "}
            {store.scenarioA?.name ?? "—"} ·{" "}
            <span className="font-semibold text-purple-400">B</span> ={" "}
            {store.scenarioB?.name ?? "—"} · Comparison panel shown below
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Scenario Comparison Panel ─────────────────────────────────────────────────

function ScenarioComparisonPanel({
  baseline,
  scenarioA,
  scenarioB,
}: {
  baseline: CapacitySnapshot;
  scenarioA: CapacityScenario | null;
  scenarioB: CapacityScenario | null;
}) {
  const baseRisk = normalizeRisk(baseline.riskLevel);

  type ColData = {
    label: string;
    currentLoadMW: number;
    addedMW: number;
    utilizationPct: number;
    headroomMW: number;
    riskLevel: CopilotRiskDisplay;
    accent: string;
  };

  const cols: ColData[] = [
    {
      label:           "Baseline",
      currentLoadMW:   baseline.currentLoadMW,
      addedMW:         0,
      utilizationPct:  baseline.utilizationPct,
      headroomMW:      baseline.headroomMW,
      riskLevel:       baseRisk,
      accent:          "text-muted-foreground",
    },
    ...(scenarioA
      ? [
          {
            label:           "Scenario A",
            currentLoadMW:   baseline.currentLoadMW + scenarioA.addedMW,
            addedMW:         scenarioA.addedMW,
            utilizationPct:  scenarioA.projectedUtilizationPct,
            headroomMW:      scenarioA.headroomMW,
            riskLevel:       scenarioA.riskLevel,
            accent:          "text-blue-400",
          } satisfies ColData,
        ]
      : []),
    ...(scenarioB
      ? [
          {
            label:           "Scenario B",
            currentLoadMW:   baseline.currentLoadMW + scenarioB.addedMW,
            addedMW:         scenarioB.addedMW,
            utilizationPct:  scenarioB.projectedUtilizationPct,
            headroomMW:      scenarioB.headroomMW,
            riskLevel:       scenarioB.riskLevel,
            accent:          "text-purple-400",
          } satisfies ColData,
        ]
      : []),
  ];

  const rows: { label: string; render: (col: ColData) => React.ReactNode }[] = [
    {
      label: "Current Load MW",
      render: (c) => (
        <span className="font-mono">{c.currentLoadMW.toLocaleString()} MW</span>
      ),
    },
    {
      label: "Added MW",
      render: (c) => (
        <span className="font-mono text-cyan-400">
          {c.addedMW === 0 ? "—" : `+${c.addedMW.toLocaleString()} MW`}
        </span>
      ),
    },
    {
      label: "Utilization %",
      render: (c) => (
        <span className={`font-mono font-bold ${RISK_COLOR[c.riskLevel]}`}>
          {c.utilizationPct}%
        </span>
      ),
    },
    {
      label: "Headroom MW",
      render: (c) => (
        <span className={`font-mono ${c.headroomMW < 0 ? "text-red-400" : "text-emerald-400"}`}>
          {c.headroomMW < 0 ? "−" : ""}{Math.abs(c.headroomMW).toLocaleString()} MW
        </span>
      ),
    },
    {
      label: "Risk Level",
      render: (c) => (
        <Badge variant="outline" className={`text-[10px] ${RISK_BADGE[c.riskLevel]}`}>
          {c.riskLevel}
        </Badge>
      ),
    },
  ];

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Scenario Comparison</CardTitle>
        <CardDescription>
          Side-by-side capacity impact across{" "}
          {[scenarioA && "Scenario A", scenarioB && "Scenario B"]
            .filter(Boolean)
            .join(" and ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-border/30">
              <th className="py-2 pr-4 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Metric
              </th>
              {cols.map((c) => (
                <th
                  key={c.label}
                  className={`py-2 px-4 text-right text-[10px] font-semibold uppercase tracking-wider ${c.accent}`}
                >
                  {c.label}
                  {c.label !== "Baseline" && (
                    <span className="ml-1 normal-case text-muted-foreground/60">
                      {c.label === "Scenario A" ? `(${scenarioA?.name})` : `(${scenarioB?.name})`}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {rows.map((row) => (
              <tr key={row.label} className="hover:bg-white/[0.02]">
                <td className="py-3 pr-4 text-[11px] text-muted-foreground">
                  {row.label}
                </td>
                {cols.map((col) => (
                  <td key={col.label} className="py-3 px-4 text-right">
                    {row.render(col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ── Scenario Impact Chart ─────────────────────────────────────────────────────

const CHART_MW_POINTS = [0, 50, 100, 250, 500, 1000] as const;

function ScenarioImpactChart({
  baseline,
  currentMW,
}: {
  baseline: CapacitySnapshot;
  currentMW: number;
}) {
  const chartData = CHART_MW_POINTS.map((mw) => {
    const result = simulateDataCenter(baseline, mw);
    return {
      label:          mw === 0 ? "Current" : `+${mw} MW`,
      utilizationPct: result.utilizationPct,
      mw,
    };
  });

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Scenario Impact Chart</CardTitle>
        <CardDescription>
          Eastern MA capacity utilization across demand scenarios · baseline at{" "}
          {baseline.utilizationPct}%
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 14%)" />
              <XAxis
                dataKey="label"
                stroke="hsl(215 20% 55%)"
                fontSize={11}
              />
              <YAxis
                stroke="hsl(215 20% 55%)"
                fontSize={11}
                tickFormatter={(v: number) => `${v}%`}
                domain={[
                  Math.max(0, Math.floor(baseline.utilizationPct) - 5),
                  Math.min(110, Math.ceil(simulateDataCenter(baseline, 1000).utilizationPct) + 5),
                ]}
                width={48}
              />
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                formatter={(v: number) => [`${v}%`, "Utilization"]}
              />
              <ReferenceLine
                y={60}
                stroke="#f59e0b"
                strokeDasharray="4 3"
                strokeOpacity={0.5}
                label={{ value: "60% Medium", fill: "#f59e0b", fontSize: 9 }}
              />
              <ReferenceLine
                y={75}
                stroke="#f97316"
                strokeDasharray="4 3"
                strokeOpacity={0.5}
                label={{ value: "75% High", fill: "#f97316", fontSize: 9 }}
              />
              <ReferenceLine
                y={90}
                stroke="#ef4444"
                strokeDasharray="4 3"
                strokeOpacity={0.5}
                label={{ value: "90% Critical", fill: "#ef4444", fontSize: 9 }}
              />
              {/* Mark the current simulator value */}
              {CHART_MW_POINTS.includes(currentMW as typeof CHART_MW_POINTS[number]) && (
                <ReferenceLine
                  x={currentMW === 0 ? "Current" : `+${currentMW} MW`}
                  stroke="hsl(187 85% 53%)"
                  strokeDasharray="3 3"
                  strokeOpacity={0.7}
                />
              )}
              <Line
                type="monotone"
                dataKey="utilizationPct"
                name="Utilization"
                stroke="hsl(187 85% 53%)"
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props as {
                    cx: number; cy: number;
                    payload: (typeof chartData)[number];
                  };
                  const isCurrent = payload.mw === currentMW;
                  return (
                    <circle
                      key={payload.label}
                      cx={cx}
                      cy={cy}
                      r={isCurrent ? 5 : 3}
                      fill={isCurrent ? "hsl(187 85% 53%)" : "hsl(222 47% 6%)"}
                      stroke="hsl(187 85% 53%)"
                      strokeWidth={2}
                    />
                  );
                }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ── AI Executive Summary ──────────────────────────────────────────────────────

const EXEC_FIELDS: Array<{
  key: keyof CapacityImpactResponse["_executive"];
  label: string;
  icon: string;
}> = [
  { key: "operationalImpact",          label: "Operational Impact",          icon: "⚡" },
  { key: "capacityRisk",               label: "Capacity Risk",               icon: "🔋" },
  { key: "recommendedUpgradeTimeline", label: "Recommended Upgrade Timeline", icon: "📅" },
  { key: "investmentPriority",         label: "Investment Priority",          icon: "💰" },
];

function ExecutiveSummaryCard({ addedMW }: { addedMW: number }) {
  const [data, setData] = useState<CapacityImpactResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch("/api/copilot/capacity-impact", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ addedMW }),
        signal:  controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`API ${res.status}`);
          return res.json() as Promise<CapacityImpactResponse>;
        })
        .then((d) => { setData(d); setLoading(false); })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [addedMW]);

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <CardTitle>AI Executive Summary</CardTitle>
        </div>
        <CardDescription>
          Executive-level capacity analysis for +{addedMW.toLocaleString()} MW scenario
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-32 rounded bg-border/40" />
                <div className="h-3 w-full rounded bg-border/30" />
                <div className="h-3 w-5/6 rounded bg-border/30" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {!loading && data && (
          <div className="space-y-5">
            {/* Risk badge header */}
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={RISK_BADGE[data.riskLevel as CopilotRiskDisplay]}
              >
                {data.riskLevel} Risk
              </Badge>
              <span className="text-xs text-muted-foreground">
                {data._meta.baseUtilizationPct}% → {data._meta.projectedUtilizationPct}% utilization ·{" "}
                {data._meta.remainingHeadroomMW.toLocaleString()} MW headroom
              </span>
            </div>

            {/* Four executive fields */}
            {EXEC_FIELDS.map(({ key, label, icon }) => (
              <div key={key} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{icon}</span>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {data._executive[key]}
                </p>
              </div>
            ))}

            {/* Most affected substations */}
            {data.mostAffectedSubstations.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Most Affected Substations
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.mostAffectedSubstations.map((ss, i) => (
                    <span
                      key={ss.name}
                      className="flex items-center gap-1.5 rounded-md border border-border/30 bg-background/30 px-2.5 py-1 text-xs"
                    >
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      {ss.name}
                      <span className="font-mono text-cyan-400">+{ss.addedMW} MW</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground/50">
              Analysis generated using live Eastern MA capacity data ·{" "}
              {new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
