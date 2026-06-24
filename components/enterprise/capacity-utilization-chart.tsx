"use client";

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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GridLoad } from "@/lib/types";
import { EASTERN_MA_FRACTION } from "@/lib/services/capacity.service";
import { TERRITORY_CAPACITY_MW as CAPACITY_MW } from "@/lib/enterprise-data";

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(222 47% 6%)",
    border: "1px solid hsl(217 33% 14%)",
    borderRadius: "8px",
    fontSize: "12px",
  },
  labelStyle: { color: "hsl(210 40% 98%)" },
};

interface CapacityUtilizationChartProps {
  readings: GridLoad[];
}

export function CapacityUtilizationChart({
  readings,
}: CapacityUtilizationChartProps) {
  if (readings.length === 0) return null;

  const data = readings.map((r) => {
    const easternMALoad = Math.round(r.currentLoadMW * EASTERN_MA_FRACTION);
    const utilizationPct =
      Math.round((easternMALoad / CAPACITY_MW) * 1_000) / 10;
    return {
      time: new Date(r.timestamp).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        hour12: true,
      }),
      utilizationPct,
    };
  });

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Capacity Utilization</CardTitle>
        <CardDescription>
          Eastern MA estimated load as % of 6,500 MW installed capacity ·{" "}
          {readings.length} readings
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(217 33% 14%)"
              />
              <XAxis
                dataKey="time"
                stroke="hsl(215 20% 55%)"
                fontSize={10}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="hsl(215 20% 55%)"
                fontSize={11}
                tickFormatter={(v: number) => `${v}%`}
                domain={[0, 100]}
                width={48}
              />
              <Tooltip
                {...chartTooltipStyle}
                formatter={(value: number) => [`${value}%`, "Utilization"]}
              />
              {/* Risk thresholds */}
              <ReferenceLine
                y={70}
                stroke="hsl(48 96% 53%)"
                strokeDasharray="4 3"
                strokeOpacity={0.5}
                label={{ value: "70% Moderate", fill: "hsl(48 96% 53%)", fontSize: 9 }}
              />
              <ReferenceLine
                y={85}
                stroke="hsl(24 95% 53%)"
                strokeDasharray="4 3"
                strokeOpacity={0.5}
                label={{ value: "85% High", fill: "hsl(24 95% 53%)", fontSize: 9 }}
              />
              <Line
                type="monotone"
                dataKey="utilizationPct"
                name="Utilization"
                stroke="hsl(187 85% 53%)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
