"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  MapPin,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  calculateForecast,
  getRiskColor,
  type RiskLevel,
} from "@/lib/forecast";
import { defaultForecastInputs } from "@/lib/config";
import { formatMW, formatPercent } from "@/lib/utils";

function getRiskBadgeVariant(
  risk: RiskLevel
): "success" | "warning" | "danger" {
  switch (risk) {
    case "LOW":
      return "success";
    case "MEDIUM":
      return "warning";
    case "HIGH":
      return "danger";
  }
}

function getRiskIcon(risk: RiskLevel) {
  switch (risk) {
    case "LOW":
      return CheckCircle2;
    case "MEDIUM":
      return AlertTriangle;
    case "HIGH":
      return AlertTriangle;
  }
}

export default function DashboardPage() {
  const [cityName, setCityName] = useState(defaultForecastInputs.cityName);
  const [currentPeakLoad, setCurrentPeakLoad] = useState(
    String(defaultForecastInputs.currentPeakLoad)
  );
  const [populationGrowthRate, setPopulationGrowthRate] = useState(
    String(defaultForecastInputs.populationGrowthRate)
  );
  const [evGrowthRate, setEvGrowthRate] = useState(
    String(defaultForecastInputs.evGrowthRate)
  );
  const [dataCenterLoad, setDataCenterLoad] = useState(
    String(defaultForecastInputs.dataCenterLoad)
  );

  const result = useMemo(() => {
    const load = parseFloat(currentPeakLoad) || 0;
    const pop = parseFloat(populationGrowthRate) || 0;
    const ev = parseFloat(evGrowthRate) || 0;
    const dc = parseFloat(dataCenterLoad) || 0;

    return calculateForecast({
      cityName,
      currentPeakLoad: load,
      populationGrowthRate: pop,
      evGrowthRate: ev,
      dataCenterLoad: dc,
    });
  }, [cityName, currentPeakLoad, populationGrowthRate, evGrowthRate, dataCenterLoad]);

  const RiskIcon = getRiskIcon(result.riskLevel);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">
          Forecast Dashboard
        </h1>
        <p className="mt-2 text-muted-foreground">
          Model future electrical load growth and receive risk assessments with
          capacity recommendations.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* Inputs */}
        <Card className="border-border/60 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-primary" />
              Forecast Inputs
            </CardTitle>
            <CardDescription>
              Configure parameters for your service territory
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="city">City Name</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="city"
                  value={cityName}
                  onChange={(e) => setCityName(e.target.value)}
                  className="pl-9"
                  placeholder="Boston"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="load">Current Peak Load (MW)</Label>
              <Input
                id="load"
                type="number"
                min="0"
                step="1"
                value={currentPeakLoad}
                onChange={(e) => setCurrentPeakLoad(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pop">Population Growth Rate (%)</Label>
              <Input
                id="pop"
                type="number"
                min="0"
                step="0.1"
                value={populationGrowthRate}
                onChange={(e) => setPopulationGrowthRate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ev">EV Growth Rate (%)</Label>
              <Input
                id="ev"
                type="number"
                min="0"
                step="0.1"
                value={evGrowthRate}
                onChange={(e) => setEvGrowthRate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dc">New Data Center Load (MW)</Label>
              <Input
                id="dc"
                type="number"
                min="0"
                step="1"
                value={dataCenterLoad}
                onChange={(e) => setDataCenterLoad(e.target.value)}
              />
            </div>

            <Button
              className="w-full"
              onClick={() => {
                setCityName(defaultForecastInputs.cityName);
                setCurrentPeakLoad(
                  String(defaultForecastInputs.currentPeakLoad)
                );
                setPopulationGrowthRate(
                  String(defaultForecastInputs.populationGrowthRate)
                );
                setEvGrowthRate(String(defaultForecastInputs.evGrowthRate));
                setDataCenterLoad(
                  String(defaultForecastInputs.dataCenterLoad)
                );
              }}
              variant="outline"
            >
              Reset to Defaults
            </Button>
          </CardContent>
        </Card>

        {/* Outputs */}
        <div className="space-y-6 lg:col-span-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardDescription>Forecasted Load</CardDescription>
                <CardTitle className="font-mono text-2xl text-primary">
                  {formatMW(result.futureLoad)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {cityName || "—"} · +{formatPercent(result.increasePercent)}{" "}
                  increase
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardDescription>Risk Level</CardDescription>
                <div className="flex items-center gap-2">
                  <RiskIcon
                    className="h-5 w-5"
                    style={{ color: getRiskColor(result.riskLevel) }}
                  />
                  <Badge variant={getRiskBadgeVariant(result.riskLevel)}>
                    {result.riskLevel}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {result.riskLevel === "LOW" && "<10% load increase"}
                  {result.riskLevel === "MEDIUM" && "10–25% load increase"}
                  {result.riskLevel === "HIGH" && ">25% load increase"}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardDescription>Current Baseline</CardDescription>
                <CardTitle className="font-mono text-2xl">
                  {formatMW(parseFloat(currentPeakLoad) || 0)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Peak demand today
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Load breakdown */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="h-5 w-5 text-primary" />
                Load Contribution Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  {
                    label: "Population Growth",
                    value: result.populationContribution,
                    color: "bg-chart-3",
                  },
                  {
                    label: "EV Adoption",
                    value: result.evContribution,
                    color: "bg-chart-1",
                  },
                  {
                    label: "Data Centers",
                    value: result.dataCenterContribution,
                    color: "bg-chart-2",
                  },
                ].map((item) => {
                  const total =
                    result.populationContribution +
                    result.evContribution +
                    result.dataCenterContribution;
                  const pct = total > 0 ? (item.value / total) * 100 : 0;
                  return (
                    <div key={item.label}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{item.label}</span>
                        <span className="font-mono text-muted-foreground">
                          {formatMW(item.value)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={`h-full rounded-full ${item.color}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Recommendation */}
          <Card
            className="border-border/60"
            style={{
              borderColor: `${getRiskColor(result.riskLevel)}33`,
            }}
          >
            <CardHeader>
              <CardTitle className="text-lg">Capacity Recommendation</CardTitle>
              <CardDescription>
                Based on {result.riskLevel} risk classification
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {result.capacityRecommendation}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
