"use client";

import { useMemo, useState } from "react";
import { Activity, Battery, Gauge, ShieldAlert, TrendingUp } from "lucide-react";
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
import type { SubstationPlan } from "@/lib/types";
import type { UpgradeProject } from "@/lib/data/capital-projects";
import {
  computeSubstationRisk,
  projectSubstationLoad,
  type AssetRiskLevel,
  type RiskAssessment,
} from "@/lib/services/asset-risk.service";

// ── Risk styling ──────────────────────────────────────────────────────────────

const RISK_COLOR: Record<AssetRiskLevel, string> = {
  LOW:      "text-emerald-400",
  MEDIUM:   "text-yellow-400",
  HIGH:     "text-orange-400",
  CRITICAL: "text-red-400",
};

const RISK_BADGE: Record<AssetRiskLevel, string> = {
  LOW:      "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  MEDIUM:   "bg-yellow-500/15  text-yellow-400  border-yellow-500/30",
  HIGH:     "bg-orange-500/15  text-orange-400  border-orange-500/30",
  CRITICAL: "bg-red-500/15     text-red-400     border-red-500/30",
};

const SIM_PRESETS = [0, 50, 100, 250, 500] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

interface AssetDigitalTwinProps {
  substation: SubstationPlan;
  projects: UpgradeProject[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AssetDigitalTwin({
  substation,
  projects,
}: AssetDigitalTwinProps) {
  const [simulatedMW, setSimulatedMW] = useState(0);
  const [customInput, setCustomInput] = useState("");

  // ── Current metrics ────────────────────────────────────────────────────────
  const currentUtilPct =
    substation.nameplateMVA > 0
      ? Math.round((substation.peakLoadMW / substation.nameplateMVA) * 1_000) / 10
      : 0;
  const currentN1Headroom = substation.n1CapacityMW - substation.peakLoadMW;
  const currentHeadroom = substation.nameplateMVA - substation.peakLoadMW;
  const currentRisk = useMemo(
    () => computeSubstationRisk(substation, projects),
    [substation, projects]
  );

  // ── Projected metrics ──────────────────────────────────────────────────────
  const projection = useMemo(
    () => projectSubstationLoad(substation, simulatedMW, projects),
    [substation, simulatedMW, projects]
  );

  function applyCustom() {
    const v = parseFloat(customInput);
    if (!isNaN(v) && v >= 0) { setSimulatedMW(Math.round(v)); setCustomInput(""); }
  }

  const isSimulating = simulatedMW > 0;

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-400" />
              Digital Twin — {substation.name}
            </CardTitle>
            <CardDescription>
              Current state · scenario projection · risk assessment
            </CardDescription>
          </div>
          <Badge variant="outline" className={RISK_BADGE[currentRisk.riskLevel]}>
            {currentRisk.riskLevel} Risk
          </Badge>
        </div>

        {/* Scenario strip */}
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border/30 bg-background/20 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Simulate Added Load
          </span>
          {SIM_PRESETS.map((mw) => (
            <Button
              key={mw}
              size="sm"
              variant={simulatedMW === mw ? "default" : "outline"}
              className={`h-6 px-2.5 text-xs ${
                simulatedMW === mw
                  ? "bg-primary text-primary-foreground"
                  : "border-border/40 bg-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => { setSimulatedMW(mw); setCustomInput(""); }}
            >
              {mw === 0 ? "Baseline" : `+${mw} MW`}
            </Button>
          ))}
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              placeholder="Custom MW"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCustom()}
              className="h-6 w-24 border-border/40 bg-transparent px-2 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs border-border/40 bg-transparent"
              onClick={applyCustom}
            >
              Apply
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Column 1: Current State */}
          <TwinColumn
            title="Current State"
            subtitle="Live asset readings"
            accent="text-cyan-400"
            icon={<Battery className="h-3.5 w-3.5 text-cyan-400" />}
          >
            <TwinMetric label="Peak Load"      value={`${substation.peakLoadMW} MW`} />
            <TwinMetric label="Nameplate"      value={`${substation.nameplateMVA} MVA`} />
            <TwinMetric label="N-1 Capacity"   value={`${substation.n1CapacityMW} MW`} />
            <TwinMetric
              label="Utilization"
              value={`${currentUtilPct}%`}
              accent={currentUtilPct >= 85 ? "text-red-400" : currentUtilPct >= 75 ? "text-yellow-400" : "text-emerald-400"}
            />
            <TwinMetric
              label="N-1 Headroom"
              value={`${currentN1Headroom} MW`}
              accent={currentN1Headroom <= 0 ? "text-red-400" : currentN1Headroom < 20 ? "text-orange-400" : "text-emerald-400"}
            />
            <TwinMetric
              label="Headroom"
              value={`${currentHeadroom} MW`}
              accent={currentHeadroom < 0 ? "text-red-400" : "text-muted-foreground"}
            />
            <UtilBar pct={currentUtilPct} />
          </TwinColumn>

          {/* Column 2: Projected State */}
          <TwinColumn
            title={isSimulating ? `Projected +${simulatedMW} MW` : "Projected State"}
            subtitle={isSimulating ? "Under simulated load" : "No simulation active"}
            accent={isSimulating ? "text-cyan-400" : "text-muted-foreground"}
            icon={<TrendingUp className="h-3.5 w-3.5 text-cyan-400" />}
          >
            <TwinMetric
              label="Projected Load"
              value={`${projection.projectedLoadMW} MW`}
              accent={isSimulating ? "text-cyan-400" : undefined}
            />
            <TwinMetric label="Nameplate"    value={`${substation.nameplateMVA} MVA`} />
            <TwinMetric label="N-1 Capacity" value={`${substation.n1CapacityMW} MW`} />
            <TwinMetric
              label="Utilization"
              value={`${projection.projectedUtilizationPct}%`}
              accent={
                projection.projectedUtilizationPct >= 85 ? "text-red-400" :
                projection.projectedUtilizationPct >= 75 ? "text-yellow-400" :
                "text-emerald-400"
              }
            />
            <TwinMetric
              label="N-1 Headroom"
              value={`${projection.projectedN1HeadroomMW} MW`}
              accent={projection.projectedN1HeadroomMW <= 0 ? "text-red-400" : projection.projectedN1HeadroomMW < 20 ? "text-orange-400" : "text-emerald-400"}
            />
            <TwinMetric
              label="Headroom"
              value={`${projection.projectedHeadroomMW} MW`}
              accent={projection.projectedHeadroomMW < 0 ? "text-red-400" : "text-muted-foreground"}
            />
            <UtilBar pct={projection.projectedUtilizationPct} />
          </TwinColumn>

          {/* Column 3: Risk State */}
          <TwinColumn
            title="Risk Assessment"
            subtitle={isSimulating ? "Projected risk" : "Current risk"}
            accent={RISK_COLOR[isSimulating ? projection.projectedRisk.riskLevel : currentRisk.riskLevel]}
            icon={<ShieldAlert className="h-3.5 w-3.5" />}
          >
            <RiskDisplay risk={isSimulating ? projection.projectedRisk : currentRisk} />
          </TwinColumn>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TwinColumn({
  title,
  subtitle,
  accent,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  accent: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-background/20 p-4 space-y-3">
      <div className="flex items-center gap-1.5">
        <span className={accent}>{icon}</span>
        <div>
          <p className={`text-xs font-semibold ${accent}`}>{title}</p>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function TwinMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`font-mono text-xs font-semibold ${accent ?? "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function UtilBar({ pct }: { pct: number }) {
  const color =
    pct >= 85 ? "bg-red-500" :
    pct >= 75 ? "bg-orange-500" :
    pct >= 60 ? "bg-yellow-500" :
    "bg-emerald-500";
  return (
    <div className="pt-1">
      <div className="h-1.5 w-full rounded-full bg-border/40">
        <div
          className={`h-1.5 rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

function RiskDisplay({ risk }: { risk: RiskAssessment }) {
  return (
    <div className="space-y-3">
      <div className="text-center py-2">
        <p className={`text-4xl font-mono font-bold ${RISK_COLOR[risk.riskLevel]}`}>
          {risk.riskScore}
        </p>
        <p className="text-[10px] text-muted-foreground">risk score / 100</p>
        <Badge variant="outline" className={`mt-1 ${RISK_BADGE[risk.riskLevel]}`}>
          {risk.riskLevel}
        </Badge>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Risk Drivers
        </p>
        {risk.drivers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No significant risk factors identified.</p>
        ) : (
          <ul className="space-y-1.5">
            {risk.drivers.map((d) => (
              <li key={d} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  risk.riskLevel === "CRITICAL" ? "bg-red-500" :
                  risk.riskLevel === "HIGH"     ? "bg-orange-500" :
                  risk.riskLevel === "MEDIUM"   ? "bg-yellow-500" :
                  "bg-emerald-500"
                }`} />
                {d}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
