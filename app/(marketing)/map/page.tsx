"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { substations, type Substation } from "@/lib/sample-data";
import { cn, formatMW } from "@/lib/utils";

function getStatusConfig(status: Substation["status"]) {
  switch (status) {
    case "normal":
      return {
        label: "Normal",
        color: "#22c55e",
        badgeVariant: "success" as const,
        icon: CheckCircle2,
      };
    case "warning":
      return {
        label: "Warning",
        color: "#eab308",
        badgeVariant: "warning" as const,
        icon: Info,
      };
    case "capacity-risk":
      return {
        label: "Capacity Risk",
        color: "#ef4444",
        badgeVariant: "danger" as const,
        icon: AlertTriangle,
      };
  }
}

export default function GridMapPage() {
  const [selected, setSelected] = useState<Substation | null>(null);

  const normalCount = substations.filter((s) => s.status === "normal").length;
  const warningCount = substations.filter(
    (s) => s.status === "warning"
  ).length;
  const riskCount = substations.filter(
    (s) => s.status === "capacity-risk"
  ).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Grid Map</h1>
        <p className="mt-2 text-muted-foreground">
          Real-time substation capacity monitoring across the Greater Boston
          service territory.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="h-3 w-3 rounded-full bg-green-500" />
            <div>
              <p className="text-2xl font-bold">{normalCount}</p>
              <p className="text-xs text-muted-foreground">Normal</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/20 bg-yellow-500/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="h-3 w-3 rounded-full bg-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{warningCount}</p>
              <p className="text-xs text-muted-foreground">Warning</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <div>
              <p className="text-2xl font-bold">{riskCount}</p>
              <p className="text-xs text-muted-foreground">Capacity Risk</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Map */}
        <Card className="border-border/60 lg:col-span-2">
          <CardHeader>
            <CardTitle>Service Territory</CardTitle>
            <CardDescription>
              Greater Boston Metro — click a substation for details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-border/60 bg-[#0a0f1a]">
              {/* Grid background */}
              <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-20" />

              {/* Stylized map regions */}
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 70"
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Water body */}
                <path
                  d="M 85 5 Q 95 20 90 40 Q 88 55 80 65 L 75 70 L 85 70 Z"
                  fill="hsl(217 33% 10%)"
                  stroke="hsl(217 33% 18%)"
                  strokeWidth="0.3"
                />
                {/* Land regions */}
                <path
                  d="M 5 15 Q 20 8 40 12 Q 60 10 75 18 Q 82 30 78 45 Q 70 58 50 62 Q 30 65 10 55 Q 3 40 5 15 Z"
                  fill="hsl(217 33% 8%)"
                  stroke="hsl(217 33% 16%)"
                  strokeWidth="0.4"
                />
                {/* Transmission lines */}
                <line
                  x1="22"
                  y1="55"
                  x2="48"
                  y2="42"
                  stroke="hsl(187 85% 53% / 0.3)"
                  strokeWidth="0.3"
                  strokeDasharray="1 1"
                />
                <line
                  x1="48"
                  y1="42"
                  x2="58"
                  y2="22"
                  stroke="hsl(187 85% 53% / 0.3)"
                  strokeWidth="0.3"
                  strokeDasharray="1 1"
                />
                <line
                  x1="48"
                  y1="42"
                  x2="72"
                  y2="28"
                  stroke="hsl(187 85% 53% / 0.3)"
                  strokeWidth="0.3"
                  strokeDasharray="1 1"
                />
                <line
                  x1="58"
                  y1="22"
                  x2="72"
                  y2="28"
                  stroke="hsl(187 85% 53% / 0.3)"
                  strokeWidth="0.3"
                  strokeDasharray="1 1"
                />
              </svg>

              {/* Substation markers */}
              {substations.map((sub) => {
                const config = getStatusConfig(sub.status);
                const isSelected = selected?.id === sub.id;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-110 focus:outline-none"
                    style={{
                      left: `${sub.x}%`,
                      top: `${sub.y}%`,
                    }}
                    onClick={() => setSelected(sub)}
                    aria-label={`${sub.name} - ${config.label}`}
                  >
                    <div
                      className={cn(
                        "relative flex h-8 w-8 items-center justify-center rounded-full border-2",
                        isSelected && "scale-125"
                      )}
                      style={{
                        backgroundColor: `${config.color}22`,
                        borderColor: config.color,
                        boxShadow: `0 0 20px ${config.color}44`,
                      }}
                    >
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: config.color }}
                      />
                      {sub.status === "capacity-risk" && (
                        <span
                          className="absolute inset-0 animate-ping rounded-full opacity-40"
                          style={{ backgroundColor: config.color }}
                        />
                      )}
                    </div>
                    <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-foreground/80">
                      {sub.name}
                    </span>
                  </button>
                );
              })}

              {/* Map legend overlay */}
              <div className="absolute bottom-3 left-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2 backdrop-blur-sm">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </p>
                <div className="flex flex-col gap-1">
                  {[
                    { color: "#22c55e", label: "Normal" },
                    { color: "#eab308", label: "Warning" },
                    { color: "#ef4444", label: "Capacity Risk" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center gap-2 text-[10px]"
                    >
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Substation list / detail */}
        <div className="space-y-4">
          {selected ? (
            <Card className="border-border/60">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{selected.name}</CardTitle>
                  <Badge variant={getStatusConfig(selected.status).badgeVariant}>
                    {getStatusConfig(selected.status).label}
                  </Badge>
                </div>
                <CardDescription>{selected.region}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground">Current Load</p>
                  <p className="font-mono text-xl">{formatMW(selected.load)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Capacity</p>
                  <p className="font-mono text-xl">
                    {formatMW(selected.capacity)}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">
                    Utilization
                  </p>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min((selected.load / selected.capacity) * 100, 100)}%`,
                        backgroundColor: getStatusConfig(selected.status).color,
                      }}
                    />
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {((selected.load / selected.capacity) * 100).toFixed(1)}%
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/60">
              <CardContent className="flex h-40 items-center justify-center p-6">
                <p className="text-center text-sm text-muted-foreground">
                  Select a substation on the map to view details
                </p>
              </CardContent>
            </Card>
          )}

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">All Substations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {substations.map((sub) => {
                const config = getStatusConfig(sub.status);
                const Icon = config.icon;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setSelected(sub)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border border-border/40 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                      selected?.id === sub.id && "border-primary/40 bg-accent/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className="h-4 w-4"
                        style={{ color: config.color }}
                      />
                      <span className="text-sm font-medium">{sub.name}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {((sub.load / sub.capacity) * 100).toFixed(0)}%
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
