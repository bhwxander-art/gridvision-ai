"use client";

import "leaflet/dist/leaflet.css";
import { divIcon } from "leaflet";
import { useState } from "react";
import { MapContainer, TileLayer, Marker, Tooltip } from "react-leaflet";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMW } from "@/lib/utils";
import { formatCoordinates } from "@/lib/gis/projection";

// ── Map constants ─────────────────────────────────────────────────────────────

const MAP_CENTER: [number, number] = [42.39, -71.09];
const MAP_ZOOM = 12;
// CartoDB Dark Matter — free, no API key
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// ── Color helpers ─────────────────────────────────────────────────────────────

// 3-color spec: green = normal, yellow = constrained, red = critical.
// "watch" maps to green — no separate amber tier in the UI.
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

// ── Severity letters ──────────────────────────────────────────────────────────

function severityLetter(severity: ConstraintSeverity): string {
  if (severity === "critical") return "!";
  if (severity === "constrained") return "C";
  return "N"; // normal + watch
}

// ── DivIcon factory ───────────────────────────────────────────────────────────
//
// Outer div is always 44×44 px (meets minimum touch target).
// Inner div is the visible circle — sized per layer.
// `className: ""` strips Leaflet's default white leaflet-div-icon background.

function createMarkerIcon(
  letter: string,
  fill: string,
  visiblePx: number,
  dashed = false,
) {
  const border = dashed
    ? `2px dashed rgba(255,255,255,0.5)`
    : `2px solid rgba(255,255,255,0.3)`;
  const fontSize = Math.max(9, Math.round(visiblePx * 0.44));
  const glow = Math.round(visiblePx * 0.8);
  return divIcon({
    html: `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center"><div style="width:${visiblePx}px;height:${visiblePx}px;background:${fill};border-radius:50%;border:${border};display:flex;align-items:center;justify-content:center;color:#fff;font-size:${fontSize}px;font-weight:700;font-family:ui-monospace,monospace;line-height:1;box-shadow:0 0 ${glow}px ${fill}55">${letter}</div></div>`,
    className: "",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

// ── Coordinate offsets ────────────────────────────────────────────────────────

// Spread transformer markers around their parent substation so they don't stack.
const TX_OFFSETS: [number, number][] = [
  [0.004, 0.007],
  [0.004, -0.007],
  [-0.003, 0.008],
  [-0.003, -0.008],
];

// Data center markers placed south-east/south-west of the affected substation.
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

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* ── Map card ──────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/40 bg-[#0d1219]/80 lg:col-span-2">
        <CardHeader>
          <CardTitle>GIS Territory Map</CardTitle>
          <CardDescription>
            Eastern Massachusetts · substations, transformers, data center queue
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {/* min(460px, 50svh) keeps the map visible on small screens */}
          <MapContainer
            center={MAP_CENTER}
            zoom={MAP_ZOOM}
            style={{ height: "min(460px, 50svh)", width: "100%" }}
          >
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />

            {/* Substations — 26 px visible, 44 px touch target */}
            {portfolio.map((ss) => {
              const result = assessSubstationCapacity(
                ss,
                config.territory.planningHorizonYears
              );
              const fill = markerColor(result.severity);
              const letter = severityLetter(result.severity);
              return (
                <Marker
                  key={ss.id}
                  position={[ss.latitude, ss.longitude]}
                  icon={createMarkerIcon(letter, fill, 26)}
                  eventHandlers={{
                    click: () => setSelected({ kind: "substation", ss }),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -14]}>
                    {ss.name}
                  </Tooltip>
                </Marker>
              );
            })}

            {/* Transformers — 20 px visible, 44 px touch target */}
            {portfolio.flatMap((ss) =>
              ss.transformers.map((tx, i) => {
                const [dLat, dLng] = TX_OFFSETS[i % TX_OFFSETS.length];
                const sev = txSeverity(tx);
                const fill = markerColor(sev);
                return (
                  <Marker
                    key={tx.id}
                    position={[ss.latitude + dLat, ss.longitude + dLng]}
                    icon={createMarkerIcon(severityLetter(sev), fill, 20)}
                    eventHandlers={{
                      click: () =>
                        setSelected({ kind: "transformer", tx, ss }),
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -11]}>
                      {tx.name} — {ss.name}
                    </Tooltip>
                  </Marker>
                );
              })
            )}

            {/* Data centers — 22 px visible dashed, 44 px touch target */}
            {queue.map((dc, i) => {
              const ss = portfolio.find(
                (s) => s.id === dc.affectedSubstationId
              );
              if (!ss) return null;
              const [dLat, dLng] = DC_OFFSETS[i % DC_OFFSETS.length];
              const sev = dcSeverity(dc);
              const fill = markerColor(sev);
              return (
                <Marker
                  key={dc.id}
                  position={[ss.latitude + dLat, ss.longitude + dLng]}
                  icon={createMarkerIcon(severityLetter(sev), fill, 22, true)}
                  eventHandlers={{
                    click: () =>
                      setSelected({ kind: "datacenter", dc, ss }),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -12]}>
                    {dc.projectName}
                  </Tooltip>
                </Marker>
              );
            })}
          </MapContainer>

          {/* Legend — attribution satisfies CartoDB TOS (attributionControl was re-enabled above) */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/40 px-4 py-2.5 text-[11px] text-muted-foreground">
            <LegendDot color={getSeverityColor("normal")} label="N · Normal" />
            <LegendDot color={getSeverityColor("constrained")} label="C · Constrained" />
            <LegendDot color={getSeverityColor("critical")} label="! · Critical" />
            <span className="ml-auto text-[10px] opacity-60">
              © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">OSM</a>
              {" "}© <a href="https://carto.com/attributions" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">CARTO</a>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Detail panel ──────────────────────────────────────────────────── */}
      <DetailPanel selected={selected} config={config} />
    </div>
  );
}

// ── Legend dot ────────────────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  selected,
  config,
}: {
  selected: SelectedFeature | null;
  config: PlanningConfig;
}) {
  const title = selected ? featureTitle(selected) : "Select a Marker";
  const sub = selected ? featureSubtitle(selected) : undefined;

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {sub && <CardDescription>{sub}</CardDescription>}
      </CardHeader>
      <CardContent>
        {!selected && (
          <p className="text-sm text-muted-foreground">
            Click any marker on the map to view planning details.
          </p>
        )}
        {selected?.kind === "substation" && (
          <SubstationDetails ss={selected.ss} config={config} />
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

// ── Substation detail ─────────────────────────────────────────────────────────

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
      <Row
        label="Coordinates"
        value={formatCoordinates(ss.latitude, ss.longitude)}
      />
      <div className="pt-1">
        <SeverityBadge severity={r.severity} />
      </div>
      <p className="text-xs text-muted-foreground">{r.recommendedAction}</p>
    </div>
  );
}

// ── Transformer detail ────────────────────────────────────────────────────────

function TransformerDetails({
  tx,
  ss,
}: {
  tx: TransformerAsset;
  ss: SubstationPlan;
}) {
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
  study:          "Study",
  "ia-executed":  "IA Executed",
  construction:   "Construction",
  energized:      "Energized",
};

function DataCenterDetails({
  dc,
  ss,
}: {
  dc: DataCenterInterconnection;
  ss: SubstationPlan;
}) {
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
