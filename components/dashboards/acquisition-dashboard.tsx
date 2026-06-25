"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Users,
  Calendar,
  CheckCircle2,
  DollarSign,
  AlertCircle,
} from "lucide-react";

interface AcquisitionMetrics {
  totalProspects: number;
  byStage: Record<string, number>;
  demoCompleted: number;
  pilotActive: number;
  customerCount: number;
  conversionRate: number;
  arrPipeline: number;
  avgTimeToDemo: number;
  avgTimeToClosedWon: number;
}

export function AcquisitionDashboard() {
  const [metrics, setMetrics] = useState<AcquisitionMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch("/api/acquisition/metrics");
        if (!res.ok) throw new Error("Failed to fetch metrics");
        const data = await res.json();
        setMetrics(data);
      } catch (err) {
        console.error("Failed to load acquisition metrics:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  if (loading) {
    return <div className="text-center text-muted-foreground">Loading acquisition data...</div>;
  }

  if (!metrics) {
    return <div className="text-center text-destructive">Failed to load metrics</div>;
  }

  // Pipeline data for visualization
  const pipelineData = [
    { name: "Cold", value: metrics.byStage.cold || 0 },
    { name: "Contacted", value: metrics.byStage.contacted || 0 },
    { name: "Interested", value: metrics.byStage.interested || 0 },
    { name: "Demo Scheduled", value: metrics.byStage.demo_scheduled || 0 },
    { name: "Demo Completed", value: metrics.byStage.demo_completed || 0 },
    { name: "Pilot Active", value: metrics.byStage.pilot_active || 0 },
    { name: "Won", value: metrics.byStage.customer || 0 },
  ];

  const stageConversions = [
    { stage: "Cold → Contacted", rate: metrics.totalProspects > 0 ? ((metrics.byStage.contacted || 0) / metrics.byStage.cold * 100).toFixed(1) : "0" },
    { stage: "Contacted → Demo", rate: (metrics.byStage.contacted || 0) > 0 ? ((metrics.byStage.demo_scheduled || 0) / (metrics.byStage.contacted || 1) * 100).toFixed(1) : "0" },
    { stage: "Demo → Pilot", rate: (metrics.byStage.demo_completed || 0) > 0 ? ((metrics.byStage.pilot_active || 0) / (metrics.byStage.demo_completed || 1) * 100).toFixed(1) : "0" },
    { stage: "Pilot → Won", rate: (metrics.byStage.pilot_active || 0) > 0 ? ((metrics.byStage.customer || 0) / (metrics.byStage.pilot_active || 1) * 100).toFixed(1) : "0" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Customer Acquisition Dashboard</h1>
        <p className="text-muted-foreground">Track prospecting, demos, pilots, and conversions</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Prospects</p>
                <p className="text-2xl font-bold">{metrics.totalProspects}</p>
              </div>
              <Users className="h-8 w-8 text-cyan-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Demos Completed</p>
                <p className="text-2xl font-bold">{metrics.demoCompleted}</p>
                <p className="text-xs text-muted-foreground">
                  {metrics.totalProspects > 0 ? ((metrics.demoCompleted / metrics.totalProspects) * 100).toFixed(0) : 0}% of pipeline
                </p>
              </div>
              <Calendar className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pilots Active</p>
                <p className="text-2xl font-bold">{metrics.pilotActive}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Customers Won</p>
                <p className="text-2xl font-bold">{metrics.customerCount}</p>
                <p className="text-xs text-muted-foreground">
                  ARR: ${(metrics.arrPipeline / 1000000).toFixed(1)}M
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Visualization */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pipeline Funnel */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle className="text-sm">Sales Pipeline Funnel</CardTitle>
            <CardDescription className="text-xs">Prospects by stage</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={pipelineData}
                layout="vertical"
                margin={{ left: 100, right: 30, top: 5, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 14%)" />
                <XAxis type="number" stroke="hsl(215 20% 55%)" fontSize={10} />
                <Bar dataKey="value" fill="hsl(187 85% 43%)" radius={[0, 4, 4, 0]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(222 47% 6%)",
                    border: "1px solid hsl(217 33% 14%)",
                  }}
                  labelStyle={{ color: "hsl(210 40% 98%)" }}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Conversion Rates */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle className="text-sm">Stage Conversion Rates</CardTitle>
            <CardDescription className="text-xs">% advancing to next stage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stageConversions.map((item) => (
                <div key={item.stage} className="flex items-center justify-between">
                  <span className="text-xs font-medium">{item.stage}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 rounded-full bg-background/20">
                      <div
                        className="h-full rounded-full bg-cyan-400 transition-all"
                        style={{ width: `${Math.min(100, parseFloat(item.rate))}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-10 text-right">{item.rate}%</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Metrics & Timeline */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle className="text-sm">Average Time to Demo</CardTitle>
            <CardDescription className="text-xs">From first contact</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{metrics.avgTimeToDemo}</p>
            <p className="text-xs text-muted-foreground">days</p>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle className="text-sm">Avg Time to Closed Won</CardTitle>
            <CardDescription className="text-xs">Full sales cycle</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{metrics.avgTimeToClosedWon}</p>
            <p className="text-xs text-muted-foreground">days</p>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle className="text-sm">Overall Conversion Rate</CardTitle>
            <CardDescription className="text-xs">Cold → Customer</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{metrics.conversionRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">
              {metrics.totalProspects > 0
                ? `${metrics.customerCount} of ${metrics.totalProspects} prospects`
                : "No data"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Targets */}
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle className="text-sm">30-Day Acquisition Targets</CardTitle>
          <CardDescription className="text-xs">Milestone tracking</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
              <div>
                <p className="font-medium text-sm">5 Demo Completed</p>
                <p className="text-xs text-muted-foreground">by Month 1</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="font-semibold text-sm">{Math.min(metrics.demoCompleted, 5)}/5</p>
                  <p className="text-xs text-muted-foreground">{((Math.min(metrics.demoCompleted, 5) / 5) * 100).toFixed(0)}%</p>
                </div>
                {metrics.demoCompleted >= 5 && <CheckCircle2 className="h-5 w-5 text-green-400" />}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
              <div>
                <p className="font-medium text-sm">3 Pilots Active</p>
                <p className="text-xs text-muted-foreground">by Month 2</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="font-semibold text-sm">{metrics.pilotActive}/3</p>
                  <p className="text-xs text-muted-foreground">{((metrics.pilotActive / 3) * 100).toFixed(0)}%</p>
                </div>
                {metrics.pilotActive >= 3 && <CheckCircle2 className="h-5 w-5 text-green-400" />}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3">
              <div>
                <p className="font-medium text-sm">1 Customer Won</p>
                <p className="text-xs text-muted-foreground">by Month 3</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="font-semibold text-sm">{metrics.customerCount}/1</p>
                  <p className="text-xs text-muted-foreground">{((metrics.customerCount / 1) * 100).toFixed(0)}%</p>
                </div>
                {metrics.customerCount >= 1 && <CheckCircle2 className="h-5 w-5 text-green-400" />}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Alerts */}
      {metrics.pilotActive === 0 && metrics.demoCompleted > 0 && (
        <Card className="border-yellow-500/20 bg-yellow-500/10">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-4 w-4 text-yellow-400 flex-shrink-0" />
            <p className="text-sm text-yellow-300">
              {metrics.demoCompleted} demos completed, but no pilots active yet. Follow up with positive demo contacts.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
