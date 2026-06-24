"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CapacitySnapshot, RiskLevel } from "@/lib/services/capacity.service";
import { simulateDataCenter, RISK_LABELS } from "@/lib/services/capacity.service";

const PRESETS = [50, 100, 250, 500] as const;

const riskColor: Record<RiskLevel, string> = {
  low:      "text-emerald-400",
  moderate: "text-yellow-400",
  high:     "text-orange-400",
  critical: "text-red-400",
};

const barColor: Record<RiskLevel, string> = {
  low:      "bg-emerald-500",
  moderate: "bg-yellow-500",
  high:     "bg-orange-500",
  critical: "bg-red-500",
};

interface DataCenterSimulatorProps {
  baseline: CapacitySnapshot;
  onAddedMWChange?: (mw: number) => void;
}

export function DataCenterSimulator({
  baseline,
  onAddedMWChange,
}: DataCenterSimulatorProps) {
  const [selectedMW, setSelectedMW] = useState<number>(100);
  const [customInput, setCustomInput] = useState<string>("");

  const addedMW = selectedMW;
  const result = simulateDataCenter(baseline, addedMW);

  function applyPreset(mw: number) {
    setSelectedMW(mw);
    setCustomInput("");
    onAddedMWChange?.(mw);
  }

  function applyCustom() {
    const v = parseFloat(customInput);
    if (!isNaN(v) && v > 0) {
      const mw = Math.round(v);
      setSelectedMW(mw);
      onAddedMWChange?.(mw);
    }
  }

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Data Center Impact Simulator</CardTitle>
        <CardDescription>
          Model the system-level capacity effect of new data center demand on the Eastern MA grid
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* ── Scenario selector ───────────────────────────────────────────── */}
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            New Data Center Load
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((mw) => (
              <Button
                key={mw}
                variant={selectedMW === mw && !customInput ? "default" : "outline"}
                size="sm"
                onClick={() => applyPreset(mw)}
                className={
                  selectedMW === mw && !customInput
                    ? "bg-primary text-primary-foreground"
                    : "border-border/40 bg-transparent text-muted-foreground hover:text-foreground"
                }
              >
                {mw} MW
              </Button>
            ))}
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={1}
                placeholder="Custom MW"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyCustom()}
                className="h-8 w-28 border-border/40 bg-transparent px-2 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-border/40 bg-transparent text-muted-foreground hover:text-foreground"
                onClick={applyCustom}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>

        {/* ── Before / After comparison ────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          {/* Baseline */}
          <div className="rounded-lg border border-border/30 bg-background/30 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Baseline</p>
            <div>
              <p className="font-mono text-xl font-bold">{baseline.currentLoadMW.toLocaleString()} MW</p>
              <p className="text-[10px] text-muted-foreground">current load</p>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Utilization</span>
                <span className={riskColor[baseline.riskLevel]}>{baseline.utilizationPct}%</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Headroom</span>
                <span className="text-emerald-400">{baseline.headroomMW.toLocaleString()} MW</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Risk</span>
                <span className={riskColor[baseline.riskLevel]}>{RISK_LABELS[baseline.riskLevel]}</span>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border/40">
              <div
                className={`h-1.5 rounded-full ${barColor[baseline.riskLevel]}`}
                style={{ width: `${Math.min(baseline.utilizationPct, 100)}%` }}
              />
            </div>
          </div>

          {/* Projected */}
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-cyan-400">
              Projected +{addedMW.toLocaleString()} MW
            </p>
            <div>
              <p className="font-mono text-xl font-bold">{result.futureTotalLoadMW.toLocaleString()} MW</p>
              <p className="text-[10px] text-muted-foreground">future load</p>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Utilization</span>
                <span className={riskColor[result.riskLevel]}>{result.utilizationPct}%</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Headroom</span>
                <span className={result.remainingHeadroomMW < 0 ? "text-red-400" : result.remainingHeadroomMW < 500 ? "text-orange-400" : "text-emerald-400"}>
                  {result.remainingHeadroomMW < 0 ? "−" : ""}{Math.abs(result.remainingHeadroomMW).toLocaleString()} MW
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Risk</span>
                <span className={riskColor[result.riskLevel]}>{RISK_LABELS[result.riskLevel]}</span>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border/40">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${barColor[result.riskLevel]}`}
                style={{ width: `${Math.min(result.utilizationPct, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Delta summary ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/30 bg-background/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Added Load</p>
            <p className="mt-1 font-mono text-lg font-bold text-cyan-400">
              +{addedMW.toLocaleString()} MW
            </p>
          </div>
          <div className="rounded-lg border border-border/30 bg-background/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Utilization Δ</p>
            <p className={`mt-1 font-mono text-lg font-bold ${riskColor[result.riskLevel]}`}>
              +{(result.utilizationPct - baseline.utilizationPct).toFixed(1)}%
            </p>
          </div>
          <div className="rounded-lg border border-border/30 bg-background/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Headroom Δ</p>
            <p className={`mt-1 font-mono text-lg font-bold ${result.remainingHeadroomMW < 500 ? "text-red-400" : "text-muted-foreground"}`}>
              −{addedMW.toLocaleString()} MW
            </p>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground/60">
          Baseline: {baseline.currentLoadMW.toLocaleString()} MW Eastern MA estimated load ·{" "}
          {baseline.capacityMW.toLocaleString()} MW installed capacity ·{" "}
          Source: {baseline.source} · {baseline.freshness.toUpperCase()}
        </p>
      </CardContent>
    </Card>
  );
}
