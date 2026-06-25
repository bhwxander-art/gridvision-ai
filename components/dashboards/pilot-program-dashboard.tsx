"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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
import { AlertCircle, CheckCircle2, Clock, TrendingUp, Users } from "lucide-react";

interface PilotCustomer {
  id: string;
  companyName: string;
  status: "prospects" | "evaluation" | "pilot" | "decision" | "won" | "lost";
  feedbackScore?: number;
  startDate?: string;
  expectedDecisionDate?: string;
}

interface PilotMetrics {
  totalProspects: number;
  inEvaluation: number;
  inPilot: number;
  decisions30Days: number;
  avgFeedbackScore: number;
  conversionRate: number;
  servicingMW: number;
  servicingCustomers: number;
}

export function PilotProgramDashboard() {
  const [metrics, setMetrics] = useState<PilotMetrics | null>(null);
  const [customers, setCustomers] = useState<PilotCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch("/api/pilot/metrics");
        if (!res.ok) throw new Error("Failed to fetch metrics");
        const data = await res.json();
        setMetrics(data);

        const customersRes = await fetch("/api/pilot/customers");
        if (!customersRes.ok) throw new Error("Failed to fetch customers");
        const customersData = await customersRes.json();
        setCustomers(customersData);
      } catch (err) {
        console.error("Failed to load pilot metrics:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  if (loading) {
    return <div className="text-center text-muted-foreground">Loading pilot program data...</div>;
  }

  if (!metrics) {
    return <div className="text-center text-destructive">Failed to load pilot metrics</div>;
  }

  // Pipeline breakdown
  const pipelineData = [
    { name: "Prospects", value: metrics.totalProspects, fill: "#8884d8" },
    { name: "Evaluating", value: metrics.inEvaluation, fill: "#82ca9d" },
    { name: "Pilot", value: metrics.inPilot, fill: "#ffc658" },
  ];

  // Status breakdown
  const statusData = [
    { name: "Prospects", customers: metrics.totalProspects },
    { name: "Evaluation", customers: metrics.inEvaluation },
    { name: "Pilot", customers: metrics.inPilot },
    { name: "Won", customers: Math.ceil(metrics.conversionRate * metrics.inPilot / 100) },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Pilot Program Dashboard</h1>
        <p className="text-muted-foreground">Track customer evaluations and pilot success</p>
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
                <p className="text-sm text-muted-foreground">In Pilot</p>
                <p className="text-2xl font-bold">{metrics.inPilot}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Conversion Rate</p>
                <p className="text-2xl font-bold">{metrics.conversionRate.toFixed(0)}%</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Feedback</p>
                <p className="text-2xl font-bold">{metrics.avgFeedbackScore.toFixed(1)}/10</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pipeline Breakdown */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle className="text-sm">Pipeline Breakdown</CardTitle>
            <CardDescription className="text-xs">Customer distribution by stage</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pipelineData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pipelineData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Status Timeline */}
        <Card className="border-border/40 bg-[#0d1219]/80">
          <CardHeader>
            <CardTitle className="text-sm">Customer Status</CardTitle>
            <CardDescription className="text-xs">Customers by evaluation stage</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 14%)" />
                <XAxis dataKey="name" stroke="hsl(215 20% 55%)" fontSize={10} />
                <YAxis stroke="hsl(215 20% 55%)" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(222 47% 6%)",
                    border: "1px solid hsl(217 33% 14%)",
                  }}
                  labelStyle={{ color: "hsl(210 40% 98%)" }}
                />
                <Bar dataKey="customers" fill="hsl(187 85% 43%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Active Pilots */}
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle className="text-sm">Active Pilots</CardTitle>
          <CardDescription className="text-xs">Customers currently in evaluation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {customers
              .filter((c) => c.status === "pilot")
              .map((customer) => (
                <div
                  key={customer.id}
                  className="flex items-center justify-between rounded-lg border border-border/30 bg-background/20 p-3"
                >
                  <div className="flex-1">
                    <p className="font-medium text-sm">{customer.companyName}</p>
                    {customer.startDate && (
                      <p className="text-xs text-muted-foreground">
                        Started: {new Date(customer.startDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {customer.feedbackScore && (
                      <Badge variant="outline" className="text-xs">
                        {customer.feedbackScore}/10
                      </Badge>
                    )}
                    <Badge className="text-xs">Active</Badge>
                  </div>
                </div>
              ))}
            {customers.filter((c) => c.status === "pilot").length === 0 && (
              <p className="text-xs text-muted-foreground">No active pilots</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Alerts */}
      <div className="space-y-2">
        {metrics.inPilot > 0 && metrics.decisions30Days === 0 && (
          <Card className="border-yellow-500/20 bg-yellow-500/10">
            <CardContent className="flex items-center gap-3 pt-6">
              <AlertCircle className="h-4 w-4 text-yellow-400 flex-shrink-0" />
              <p className="text-sm text-yellow-300">
                {metrics.inPilot} customers in pilot—no decisions expected in next 30 days
              </p>
            </CardContent>
          </Card>
        )}

        {metrics.avgFeedbackScore < 7 && metrics.inPilot > 0 && (
          <Card className="border-orange-500/20 bg-orange-500/10">
            <CardContent className="flex items-center gap-3 pt-6">
              <AlertCircle className="h-4 w-4 text-orange-400 flex-shrink-0" />
              <p className="text-sm text-orange-300">
                Average feedback score {metrics.avgFeedbackScore.toFixed(1)}/10—follow up on concerns
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
