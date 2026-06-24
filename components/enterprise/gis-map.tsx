"use client";

import "leaflet/dist/leaflet.css";
import { divIcon } from "leaflet";
import { useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, Popup } from "react-leaflet";
import {
  assessSubstationCapacity,
  getSeverityColor,
  getSeverityLabel,
  type ConstraintSeverity,
  type DataCenterInterconnection,
  type SubstationPlan,
  type TransformerAsset,
} from "@/lib/planning-engine";
import type { PlanningConfig } from "@/lib/types";
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
import { formatMW } from "@/lib/utils";
import { formatCoordinates } from "@/lib/gis/projection";
import { useCapacityCurrent } from "@/lib/hooks/use-capacity-current";
import type { CapacitySnapshot, SubstationSimResult } from "@/lib/services/capacity.service";
import {
  RISK_LABELS,
  simulateSubstations,
} from "@/lib/services/capacity.service";

// ── Map constants ─────────────────────────────────────────────────────────────

const MAP_CENTER: [number, number] = [42.39, -71.09];
const MAP_ZOOM = 12;
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const SIM_PRESETS = [50, 100, 250, 500] as const;

// ── Layer mode ────────────────────────────────────────────────────────────────

type LayerMode = "planning" | "capacity";

// ── Planning-mode color helpers ───────────────────────────────────────────────

function markerColor(severity: ConstraintSeverity): string {
  if (severity === "watch") return getSeverityColor("normal");
  return getSeverityColor(severity);
}

function txSeverity(tx: TransformerAsset): ConstraintSeverity {
  const pct = (tx.peakLoadMVA / tx.ratedMVA) * 100;
  if (!tx.n1Compliant || pct >= 95) return "critical";
  if (pct >= 80) return "constrained";
  return "normal";
}

function dcSeverity(dc: DataCenterInterconnection): ConstraintSeverity {
  if (dc.requestedMW > 100) return "critical";
  if (dc.requestedMW > 25) return "constrained";
  return "normal";
}

function severityLetter(severity: ConstraintSeverity): string {
  if (severity === "critical") return "!";
  if (severity === "constrained") return "C";
  return "N";
}

// ── Capacity-mode color helpers ───────────────────────────────────────────────

function capacityColor(utilizationPct: number): string {
  if (utilizationPct >= 90) return "#ef4444";
  if (utilizationPct >= 75) return "#f97316";
  if (utilizationPct >= 60) return "#f59e0b";
  return "#10b981";
}

function capacityRiskLabel(utilizationPct: number): string {
  if (utilizationPct >= 90) return "Critical";
  if (utilizationPct >= 75) return "High";
  if (utilizationPct >= 60) return "Moderate";
  return "Low";
}

// ── DivIcon factory ───────────────────────────────────────────────────────────

function createMarkerIcon(
  letter: string,
  fill: string,
  visiblePx: number,
  dashed = false,
  ringColor?: string,
) {
  const border = dashed
    ? `2px dashed rgba(255,255,255,0.5)`
    : `2px solid rgba(255,255,255,0.3)`;
  const fontSize = Math.max(9, Math.round(visiblePx * 0.44));
  const glow = Math.round(visiblePx * 0.8);
  const ring = ringColor
    ? `box-shadow:0 0 0 3px ${ringColor}99,0 0 ${glow}px ${fill}55`
    : `box-shadow:0 0 ${glow}px ${fill}55`;
  return divIcon({
    html: `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center"><div style="width:${visiblePx}px;height:${visiblePx}px;background:${fill};border-radius:50%;border:${border};display:flex;align-items:center;justify-content:center;color:#fff;font-size:${fontSize}px;font-weight:700;font-family:ui-monospace,monospace;line-height:1;${ring}">${letter}</div></div>`,
    className: "",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

// ── Coordinate offsets ────────────────────────────────────────────────────────

const TX_OFFSETS: [number, number][] = [
  [0.004, 0.007],
  [0.004, -0.007],
  [-0.003, 0.008],
  [-0.003, -0.008],
];

const DC_OFFSETS: [number, number][] = [
  [-0.007, 0.010],
  [-0.007, -0.010],
  [-0.012, 0.004],
  [-0.012, -0.004],
];

// ── Selection type ────────────────────────────────────────────────────────────

type SelectedFeature =
  | { kind: "substation"; ss: SubstationPlan }
  | { kind: "transformer"; tx: TransformerAsset; ss: SubstationPlan }
  | { kind: "datacenter"; dc: DataCenterInterconnection; ss: SubstationPlan };

// ── Props ─────────────────────────────────────────────────────────────────────

export interface GisMapProps {
  portfolio: SubstationPlan[];
  queue: DataCenterInterconnection[];
  config: PlanningConfig;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function GisMap({ portfolio, queue, config }: GisMapProps) {
  const [selected, setSelected] = useState<SelectedFeature | null>(null);
  const [layerMode, setLayerMode] = useState<LayerMode>("planning");
  const [simulatedMW, setSimulatedMW] = useState<number>(0);
  const [customInput, setCustomInput] = useState<string>("");

  const { data: systemCapacity } = useCapacityCurrent();

  // Compute per-substation simulation results (only when MW > 0)
  const simResults = useMemo<Map<string, SubstationSimResult>>(
    () =>
      simulatedMW > 0
        ? simulateSubstations(portfolio, simulatedMW)
        : new Map(),
    [portfolio, simulatedMW]
  );

  const isSimulating = simulatedMW > 0;

  function applyPreset(mw: number) {
    setSimulatedMW(mw);
    setCustomInput("");
  }

  function applyCustom() {
    const v = parseFloat(customInput);
    if (!isNaN(v) && v > 0) setSimulatedMW(Math.round(v));
  }

  function clearSim() {
    setSimulatedMW(0);
    setCustomInput("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* ── Map card ──────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/40 bg-[#0d1219]/80 lg:col-span-2">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle>GIS Territory Map</CardTitle>
            <CardDescription>
              Eastern Massachusetts · substations, transformers, data center queue
            </CardDescription>
          </div>
          {/* Layer toggle */}
          <div className="flex shrink-0 gap-1 rounded-md border border-border/40 p-0.5">
            <Button
              size="sm"
              variant={layerMode === "planning" ? "default" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => { setLayerMode("planning"); clearSim(); }}
            >
              Planning
            </Button>
            <Button
              size="sm"
              variant={layerMode === "capacity" ? "default" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => setLayerMode("capacity")}
            >
              Capacity
            </Button>
          </div>
        </CardHeader>

        {/* ── Simulator strip (Capacity mode only) ────────────────────────── */}
        {layerMode === "capacity" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/40 bg-background/20 px-4 py-2.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Simulate DC load
            </span>
            <div className="flex flex-wrap gap-1.5">
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
                  onClick={() => applyPreset(mw)}
                >
                  +{mw} MW
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={1}
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
            {isSimulating && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearSim}
              >
                Clear
              </Button>
            )}
          </div>
        )}

        <CardContent className="p-0">
          <MapContainer
            center={MAP_CENTER}
            zoom={MAP_ZOOM}
            style={{ height: "min(460px, 50svh)", width: "100%" }}
          >
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />

            {/* ── Substations ─────────────────────────────────────────────── */}
            {portfolio.map((ss) => {
              const result = assessSubstationCapacity(
                ss,
                config.territory.planningHorizonYears
              );
              const sim = simResults.get(ss.id);

              // In capacity mode: use simulated utilization if active
              const displayUtilPct =
                layerMode === "capacity" && sim
                  ? sim.simUtilizationPct
                  : result.utilizationPct;

              const fill =
                layerMode === "capacity"
                  ? capacityColor(displayUtilPct)
                  : markerColor(result.severity);

              const label =
                layerMode === "capacity"
                  ? `${Math.round(displayUtilPct)}`
                  : severityLetter(result.severity);

              // Simulating and risk level changed → show ring in old color
              const ringColor =
                layerMode === "capacity" && sim && sim.simRiskLevel !== sim.baseRiskLevel
                  ? capacityColor(sim.baseUtilizationPct)
                  : undefined;

              return (
                <Marker
                  key={ss.id}
                  position={[ss.latitude, ss.longitude]}
                  icon={createMarkerIcon(label, fill, 26, false, ringColor)}
                  eventHandlers={{
                    click: () => setSelected({ kind: "substation", ss }),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -14]}>
                    {ss.name}
                  </Tooltip>

                  {layerMode === "capacity" && (
                    <Popup offset={[0, -16]}>
                      <SubstationCapacityPopup
                        ss={ss}
                        result={result}
                        sim={sim ?? null}
                      />
                    </Popup>
                  )}
                </Marker>
              );
            })}

            {/* ── Transformers ─────────────────────────────────────────────── */}
            {portfolio.flatMap((ss) =>
              ss.transformers.map((tx, i) => {
                const [dLat, dLng] = TX_OFFSETS[i % TX_OFFSETS.length];
                const sev = txSeverity(tx);
                return (
                  <Marker
                    key={tx.id}
                    position={[ss.latitude + dLat, ss.longitude + dLng]}
                    icon={createMarkerIcon(severityLetter(sev), markerColor(sev), 20)}
                    eventHandlers={{
                      click: () => setSelected({ kind: "transformer", tx, ss }),
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -11]}>
                      {tx.name} — {ss.name}
                    </Tooltip>
                  </Marker>
                );
              })
            )}

            {/* ── Data centers ─────────────────────────────────────────────── */}
            {queue.map((dc, i) => {
              const ss = portfolio.find((s) => s.id === dc.affectedSubstationId);
              if (!ss) return null;
              const [dLat, dLng] = DC_OFFSETS[i % DC_OFFSETS.length];
              const sev = dcSeverity(dc);
              return (
                <Marker
                  key={dc.id}
                  position={[ss.latitude + dLat, ss.longitude + dLng]}
                  icon={createMarkerIcon(severityLetter(sev), markerColor(sev), 22, true)}
                  eventHandlers={{
                    click: () => setSelected({ kind: "datacenter", dc, ss }),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -12]}>
                    {dc.projectName}
                  </Tooltip>
                </Marker>
              );
            })}
          </MapContainer>

          {/* ── Legend / footer ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/40 px-4 py-2.5 text-[11px] text-muted-foreground">
            {layerMode === "planning" ? (
              <>
                <LegendDot color={getSeverityColor("normal")} label="N · Normal" />
                <LegendDot color={getSeverityColor("constrained")} label="C · Constrained" />
                <LegendDot color={getSeverityColor("critical")} label="! · Critical" />
                <span className="ml-auto text-[10px] opacity-60">
                  © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">OSM</a>
                  {" "}© <a href="https://carto.com/attributions" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">CARTO</a>
                </span>
              </>
            ) : (
              <>
                <LegendDot color="#10b981" label="< 60% · Low" />
                <LegendDot color="#f59e0b" label="60–75% · Moderate" />
                <LegendDot color="#f97316" label="75–90% · High" />
                <LegendDot color="#ef4444" label="≥ 90% · Critical" />
                {isSimulating && (
                  <span className="flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                    SIMULATING +{simulatedMW.toLocaleString()} MW
                  </span>
                )}
                {!isSimulating && systemCapacity && (
                  <span className="ml-auto flex items-center gap-1.5 font-medium text-cyan-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                    System {systemCapacity.utilizationPct}% · {systemCapacity.headroomMW.toLocaleString()} MW headroom
                  </span>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Detail panel ──────────────────────────────────────────────────── */}
      <DetailPanel
        selected={selected}
        config={config}
        layerMode={layerMode}
        systemCapacity={systemCapacity}
        simResults={simResults}
        simulatedMW={simulatedMW}
      />
    </div>
  );
}

// ── Substation capacity popup ─────────────────────────────────────────────────

function SubstationCapacityPopup({
  ss,
  result,
  sim,
}: {
  ss: SubstationPlan;
  result: ReturnType<typeof assessSubstationCapacity>;
  sim: SubstationSimResult | null;
}) {
  const baseColor = capacityColor(result.utilizationPct);
  const simColor = sim ? capacityColor(sim.simUtilizationPct) : baseColor;
  const isSimulating = sim !== null;

  return (
    <div style={{ minWidth: 200, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13 }}>{ss.name}</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", color: "#94a3b8", fontWeight: 400, paddingBottom: 4 }}></th>
            {isSimulating && <th style={{ textAlign: "right", color: "#94a3b8", fontWeight: 400, paddingBottom: 4 }}>Baseline</th>}
            <th style={{ textAlign: "right", color: isSimulating ? "#22d3ee" : "#94a3b8", fontWeight: isSimulating ? 600 : 400, paddingBottom: 4 }}>
              {isSimulating ? `+${sim!.ssAddedMW} MW` : "Current"}
            </th>
          </tr>
        </thead>
        <tbody>
          <PopupRow
            label="Load"
            base={isSimulating ? `${ss.peakLoadMW} MW` : undefined}
            current={isSimulating ? `${sim!.simLoadMW} MW` : `${ss.peakLoadMW} MW`}
          />
          <PopupRow
            label="Capacity"
            current={`${ss.n1CapacityMW} MW`}
          />
          <PopupRow
            label="Headroom"
            base={isSimulating ? `${result.n1HeadroomMW} MW` : undefined}
            current={isSimulating ? `${ss.n1CapacityMW - sim!.simLoadMW} MW` : `${result.n1HeadroomMW} MW`}
          />
          <PopupRow
            label="Utilization"
            base={isSimulating ? (
              <span style={{ color: baseColor, fontWeight: 700 }}>
                {result.utilizationPct.toFixed(1)}%
              </span>
            ) : undefined}
            current={
              <span style={{ color: simColor, fontWeight: 700 }}>
                {(isSimulating ? sim!.simUtilizationPct : result.utilizationPct).toFixed(1)}%
              </span>
            }
          />
          <PopupRow
            label="Risk"
            base={isSimulating ? (
              <span style={{ color: baseColor, fontWeight: 700 }}>
                {capacityRiskLabel(result.utilizationPct)}
              </span>
            ) : undefined}
            current={
              <span style={{ color: simColor, fontWeight: 700 }}>
                {capacityRiskLabel(isSimulating ? sim!.simUtilizationPct : result.utilizationPct)}
              </span>
            }
          />
        </tbody>
      </table>
    </div>
  );
}

function PopupRow({
  label,
  base,
  current,
}: {
  label: string;
  base?: React.ReactNode;
  current: React.ReactNode;
}) {
  return (
    <tr>
      <td style={{ color: "#94a3b8", paddingBottom: 3, paddingRight: 8 }}>{label}</td>
      {base !== undefined && (
        <td style={{ fontFamily: "ui-monospace, monospace", textAlign: "right", paddingBottom: 3, paddingRight: 8, opacity: 0.6 }}>
          {base}
        </td>
      )}
      <td style={{ fontFamily: "ui-monospace, monospace", textAlign: "right", paddingBottom: 3 }}>
        {current}
      </td>
    </tr>
  );
}

// ── Legend dot ────────────────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  selected,
  config,
  layerMode,
  systemCapacity,
  simResults,
  simulatedMW,
}: {
  selected: SelectedFeature | null;
  config: PlanningConfig;
  layerMode: LayerMode;
  systemCapacity: CapacitySnapshot | null;
  simResults: Map<string, SubstationSimResult>;
  simulatedMW: number;
}) {
  const title = selected ? featureTitle(selected) : "Select a Marker";
  const sub = selected ? featureSubtitle(selected) : undefined;
  const isSimulating = simulatedMW > 0;

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {sub && <CardDescription>{sub}</CardDescription>}
      </CardHeader>
      <CardContent>
        {!selected && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Click any marker on the map to view{" "}
              {layerMode === "capacity" ? "capacity" : "planning"} details.
            </p>
            {layerMode === "capacity" && systemCapacity && (
              <SystemCapacitySummary
                snapshot={systemCapacity}
                simulatedMW={simulatedMW}
              />
            )}
          </div>
        )}
        {selected?.kind === "substation" && (
          layerMode === "capacity" ? (
            <SubstationCapacityDetails
              ss={selected.ss}
              config={config}
              sim={simResults.get(selected.ss.id) ?? null}
              isSimulating={isSimulating}
            />
          ) : (
            <SubstationDetails ss={selected.ss} config={config} />
          )
        )}
        {selected?.kind === "transformer" && (
          <TransformerDetails tx={selected.tx} ss={selected.ss} />
        )}
        {selected?.kind === "datacenter" && (
          <DataCenterDetails dc={selected.dc} ss={selected.ss} />
        )}
      </CardContent>
    </Card>
  );
}

function featureTitle(f: SelectedFeature): string {
  if (f.kind === "substation") return f.ss.name;
  if (f.kind === "transformer") return f.tx.name;
  return f.dc.projectName;
}

function featureSubtitle(f: SelectedFeature): string {
  if (f.kind === "substation") return f.ss.region;
  if (f.kind === "transformer") return `Transformer · ${f.ss.name}`;
  return `Data Center · ${f.dc.developer}`;
}

// ── Shared row ────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: ConstraintSeverity }) {
  const color = getSeverityColor(severity);
  return (
    <Badge variant="outline" style={{ borderColor: `${color}55`, color }}>
      {getSeverityLabel(severity)}
    </Badge>
  );
}

// ── System capacity summary ───────────────────────────────────────────────────

function SystemCapacitySummary({
  snapshot,
  simulatedMW,
}: {
  snapshot: CapacitySnapshot;
  simulatedMW: number;
}) {
  const isSimulating = simulatedMW > 0;
  const simLoad = snapshot.currentLoadMW + simulatedMW;
  const simUtil = Math.round((simLoad / snapshot.capacityMW) * 1_000) / 10;
  const simHeadroom = snapshot.capacityMW - simLoad;

  const baseColor = capacityColor(snapshot.utilizationPct);
  const simColor = capacityColor(simUtil);

  return (
    <div className="space-y-2 rounded-lg border border-border/30 bg-background/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Live System · Eastern MA
        </p>
        {isSimulating && (
          <span className="text-[10px] font-semibold text-cyan-400">
            +{simulatedMW} MW sim
          </span>
        )}
      </div>

      {/* Before / After grid when simulating */}
      {isSimulating ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">Baseline</p>
            <p className="font-mono text-xs">{snapshot.currentLoadMW.toLocaleString()} MW</p>
            <p style={{ color: baseColor }} className="font-mono text-xs font-bold">
              {snapshot.utilizationPct}% · {capacityRiskLabel(snapshot.utilizationPct)}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{snapshot.headroomMW.toLocaleString()} MW hdroom</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-cyan-400/60 mb-1">Projected</p>
            <p className="font-mono text-xs">{simLoad.toLocaleString()} MW</p>
            <p style={{ color: simColor }} className="font-mono text-xs font-bold">
              {simUtil}% · {capacityRiskLabel(simUtil)}
            </p>
            <p className={`font-mono text-xs ${simHeadroom < 0 ? "text-red-400" : "text-muted-foreground"}`}>
              {simHeadroom < 0 ? "−" : ""}{Math.abs(simHeadroom).toLocaleString()} MW hdroom
            </p>
          </div>
        </div>
      ) : (
        <>
          <Row label="Current Load" value={`${snapshot.currentLoadMW.toLocaleString()} MW`} />
          <Row label="Capacity" value={`${snapshot.capacityMW.toLocaleString()} MW`} />
          <Row label="Headroom" value={`${snapshot.headroomMW.toLocaleString()} MW`} />
          <Row
            label="Utilization"
            value={<span style={{ color: baseColor }} className="font-bold">{snapshot.utilizationPct}%</span>}
          />
          <Row
            label="Risk Level"
            value={<span style={{ color: baseColor }} className="font-bold capitalize">{snapshot.riskLevel}</span>}
          />
        </>
      )}

      <p className="text-[10px] text-muted-foreground/60">
        ISO-NE: {snapshot.isoneSystemLoadMW.toLocaleString()} MW system ·{" "}
        {(100 * snapshot.currentLoadMW / snapshot.isoneSystemLoadMW).toFixed(1)}% Eastern MA share
      </p>
    </div>
  );
}

// ── Substation detail — planning mode ─────────────────────────────────────────

function SubstationDetails({
  ss,
  config,
}: {
  ss: SubstationPlan;
  config: PlanningConfig;
}) {
  const r = assessSubstationCapacity(ss, config.territory.planningHorizonYears);
  return (
    <div className="space-y-2.5">
      <Row label="Region" value={ss.region} />
      <Row label="Voltage" value={`${ss.voltageKV} kV`} />
      <Row label="Nameplate" value={`${ss.nameplateMVA} MVA`} />
      <Row label="Peak Load" value={formatMW(ss.peakLoadMW)} />
      <Row label="N-1 Capacity" value={formatMW(ss.n1CapacityMW)} />
      <Row label="N-1 Headroom" value={formatMW(r.n1HeadroomMW)} />
      <Row label="Utilization" value={`${r.utilizationPct.toFixed(1)}%`} />
      {r.yearsToConstraint !== null && (
        <Row label="Yrs to Constraint" value={r.yearsToConstraint} />
      )}
      <Row label="Coordinates" value={formatCoordinates(ss.latitude, ss.longitude)} />
      <div className="pt-1">
        <SeverityBadge severity={r.severity} />
      </div>
      <p className="text-xs text-muted-foreground">{r.recommendedAction}</p>
    </div>
  );
}

// ── Substation detail — capacity mode (with before/after) ─────────────────────

function SubstationCapacityDetails({
  ss,
  config,
  sim,
  isSimulating,
}: {
  ss: SubstationPlan;
  config: PlanningConfig;
  sim: SubstationSimResult | null;
  isSimulating: boolean;
}) {
  const r = assessSubstationCapacity(ss, config.territory.planningHorizonYears);
  const baseColor = capacityColor(r.utilizationPct);
  const simColor = sim ? capacityColor(sim.simUtilizationPct) : baseColor;

  return (
    <div className="space-y-2.5">
      <Row label="Region" value={ss.region} />

      {/* Before / After comparison when simulating */}
      {isSimulating && sim ? (
        <>
          <div className="my-1 grid grid-cols-2 gap-2 rounded-lg border border-border/30 bg-background/30 p-2.5">
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-wider text-muted-foreground/60">Baseline</p>
              <p className="font-mono text-xs">{ss.peakLoadMW} MW load</p>
              <p className="font-mono text-xs">{r.n1HeadroomMW} MW hdroom</p>
              <p style={{ color: baseColor }} className="font-mono text-xs font-bold">
                {r.utilizationPct.toFixed(1)}%
              </p>
              <p style={{ color: baseColor }} className="text-[10px]">
                {RISK_LABELS[sim.baseRiskLevel]}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-wider text-cyan-400/70">+{sim.ssAddedMW} MW sim</p>
              <p className="font-mono text-xs">{sim.simLoadMW} MW load</p>
              <p className={`font-mono text-xs ${ss.n1CapacityMW - sim.simLoadMW < 0 ? "text-red-400" : ""}`}>
                {ss.n1CapacityMW - sim.simLoadMW} MW hdroom
              </p>
              <p style={{ color: simColor }} className="font-mono text-xs font-bold">
                {sim.simUtilizationPct.toFixed(1)}%
              </p>
              <p style={{ color: simColor }} className="text-[10px]">
                {RISK_LABELS[sim.simRiskLevel]}
              </p>
            </div>
          </div>
        </>
      ) : (
        <>
          <Row label="Peak Load" value={formatMW(ss.peakLoadMW)} />
          <Row label="N-1 Capacity" value={formatMW(ss.n1CapacityMW)} />
          <Row label="N-1 Headroom" value={formatMW(r.n1HeadroomMW)} />
          <Row
            label="Utilization"
            value={<span style={{ color: baseColor }} className="font-bold">{r.utilizationPct.toFixed(1)}%</span>}
          />
          <Row
            label="Risk Level"
            value={<span style={{ color: baseColor }} className="font-bold">{capacityRiskLabel(r.utilizationPct)}</span>}
          />
        </>
      )}

      <Row label="Growth / yr" value={`${ss.annualGrowthPct}%`} />
      {r.yearsToConstraint !== null && (
        <Row label="Constraint in" value={`${r.yearsToConstraint} yr`} />
      )}
      <Row label="Coordinates" value={formatCoordinates(ss.latitude, ss.longitude)} />

      {/* Utilization bars */}
      <div className="space-y-1.5 pt-0.5">
        {isSimulating && sim && (
          <div>
            <div className="mb-0.5 flex justify-between text-[9px] text-muted-foreground/60">
              <span>Baseline</span>
              <span>{r.utilizationPct.toFixed(1)}%</span>
            </div>
            <div className="h-1 w-full rounded-full bg-border/40">
              <div
                className="h-1 rounded-full"
                style={{ width: `${Math.min(r.utilizationPct, 100)}%`, backgroundColor: baseColor }}
              />
            </div>
          </div>
        )}
        <div>
          <div className="mb-0.5 flex justify-between text-[9px] text-muted-foreground/60">
            <span>{isSimulating ? "Projected" : "Utilization"}</span>
            <span>{(isSimulating && sim ? sim.simUtilizationPct : r.utilizationPct).toFixed(1)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-border/40">
            <div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${Math.min(isSimulating && sim ? sim.simUtilizationPct : r.utilizationPct, 100)}%`,
                backgroundColor: isSimulating && sim ? simColor : baseColor,
              }}
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{r.recommendedAction}</p>
    </div>
  );
}

// ── Transformer detail ────────────────────────────────────────────────────────

function TransformerDetails({ tx, ss }: { tx: TransformerAsset; ss: SubstationPlan }) {
  const loadingPct = (tx.peakLoadMVA / tx.ratedMVA) * 100;
  const sev = txSeverity(tx);
  return (
    <div className="space-y-2.5">
      <Row label="Substation" value={ss.name} />
      <Row label="Rated" value={`${tx.ratedMVA} MVA`} />
      <Row label="Peak Load" value={`${tx.peakLoadMVA} MVA`} />
      <Row label="Loading" value={`${loadingPct.toFixed(1)}%`} />
      <Row label="Age" value={`${tx.ageYears} yrs`} />
      <Row label="N-1 Compliant" value={tx.n1Compliant ? "Yes" : "No"} />
      <div className="pt-1">
        <SeverityBadge severity={sev} />
      </div>
    </div>
  );
}

// ── Data center detail ────────────────────────────────────────────────────────

const DC_STATUS_LABEL: Record<DataCenterInterconnection["status"], string> = {
  study:         "Study",
  "ia-executed": "IA Executed",
  construction:  "Construction",
  energized:     "Energized",
};

function DataCenterDetails({ dc, ss }: { dc: DataCenterInterconnection; ss: SubstationPlan }) {
  const sev = dcSeverity(dc);
  return (
    <div className="space-y-2.5">
      <Row label="Developer" value={dc.developer} />
      <Row label="Requested" value={`${dc.requestedMW} MW`} />
      <Row label="Load Factor" value={dc.loadFactor.toFixed(2)} />
      <Row label="Target COD" value={dc.targetCOD} />
      <Row label="Ramp" value={`${dc.rampMonths} mo`} />
      <Row label="Status" value={DC_STATUS_LABEL[dc.status]} />
      <Row label="Substation" value={ss.name} />
      <div className="pt-1">
        <SeverityBadge severity={sev} />
      </div>
    </div>
  );
}
