"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  dataCenterImpactData,
  evImpactData,
  loadGrowthData,
  monthlyLoadTrend,
} from "@/lib/sample-data";

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(222 47% 6%)",
    border: "1px solid hsl(217 33% 14%)",
    borderRadius: "8px",
    fontSize: "12px",
  },
  labelStyle: { color: "hsl(210 40% 98%)" },
};

export default function AnalyticsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="mt-2 text-muted-foreground">
          Visualize load growth trends and decompose impact by EV adoption and
          data center expansion.
        </p>
      </div>

      <div className="grid gap-6">
        {/* Load Growth Chart */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Load Growth Forecast</CardTitle>
            <CardDescription>
              Projected peak load vs. baseline growth (2024–2030)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[360px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={loadGrowthData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(217 33% 14%)"
                  />
                  <XAxis
                    dataKey="year"
                    stroke="hsl(215 20% 55%)"
                    fontSize={12}
                  />
                  <YAxis
                    stroke="hsl(215 20% 55%)"
                    fontSize={12}
                    tickFormatter={(v) => `${v} MW`}
                  />
                  <Tooltip
                    {...chartTooltipStyle}
                    formatter={(value: number) => [`${value} MW`, ""]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="load"
                    name="Forecasted Load"
                    stroke="hsl(187 85% 53%)"
                    strokeWidth={2}
                    dot={{ fill: "hsl(187 85% 53%)", r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    name="Baseline Growth"
                    stroke="hsl(215 20% 55%)"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* EV Impact Chart */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>EV Impact</CardTitle>
              <CardDescription>
                Additional load (MW) by EV charging category
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={evImpactData} layout="vertical">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(217 33% 14%)"
                    />
                    <XAxis
                      type="number"
                      stroke="hsl(215 20% 55%)"
                      fontSize={12}
                      tickFormatter={(v) => `${v} MW`}
                    />
                    <YAxis
                      type="category"
                      dataKey="category"
                      stroke="hsl(215 20% 55%)"
                      fontSize={11}
                      width={110}
                    />
                    <Tooltip
                      {...chartTooltipStyle}
                      formatter={(value: number) => [`${value} MW`, "Impact"]}
                    />
                    <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
                      {evImpactData.map((entry) => (
                        <Cell key={entry.category} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Data Center Impact Chart */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>Data Center Impact</CardTitle>
              <CardDescription>
                Additional load (MW) by facility type
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dataCenterImpactData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={3}
                      dataKey="impact"
                      nameKey="category"
                      label={({ category, percent }) =>
                        `${category} ${(percent * 100).toFixed(0)}%`
                      }
                      labelLine={{ stroke: "hsl(215 20% 55%)" }}
                    >
                      {dataCenterImpactData.map((entry) => (
                        <Cell key={entry.category} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      {...chartTooltipStyle}
                      formatter={(value: number) => [`${value} MW`, "Impact"]}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Monthly trend */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Monthly Load Composition</CardTitle>
            <CardDescription>
              Total load with EV and data center contributions (2024)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyLoadTrend}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(217 33% 14%)"
                  />
                  <XAxis
                    dataKey="month"
                    stroke="hsl(215 20% 55%)"
                    fontSize={12}
                  />
                  <YAxis
                    stroke="hsl(215 20% 55%)"
                    fontSize={12}
                    tickFormatter={(v) => `${v}`}
                  />
                  <Tooltip
                    {...chartTooltipStyle}
                    formatter={(value: number, name: string) => [
                      `${value} MW`,
                      name === "ev"
                        ? "EV Load"
                        : name === "datacenter"
                          ? "Data Center"
                          : "Total",
                    ]}
                  />
                  <Legend
                    formatter={(value) =>
                      value === "ev"
                        ? "EV Load"
                        : value === "datacenter"
                          ? "Data Center"
                          : "Total Load"
                    }
                  />
                  <Bar
                    dataKey="total"
                    name="total"
                    fill="hsl(217 33% 20%)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="ev"
                    name="ev"
                    fill="hsl(187 85% 53%)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="datacenter"
                    name="datacenter"
                    fill="hsl(262 83% 58%)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
