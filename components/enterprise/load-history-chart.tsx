"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
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

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(222 47% 6%)",
    border: "1px solid hsl(217 33% 14%)",
    borderRadius: "8px",
    fontSize: "12px",
  },
  labelStyle: { color: "hsl(210 40% 98%)" },
};

interface LoadHistoryChartProps {
  readings: GridLoad[];
}

export function LoadHistoryChart({ readings }: LoadHistoryChartProps) {
  if (readings.length === 0) return null;

  const data = readings.map((r) => ({
    time: new Date(r.timestamp).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      hour12: true,
    }),
    mw: r.currentLoadMW,
  }));

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <CardTitle>Live Load History</CardTitle>
        <CardDescription>
          ISO-NE Eastern Massachusetts · {readings.length} hourly readings from Supabase
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 14%)" />
              <XAxis
                dataKey="time"
                stroke="hsl(215 20% 55%)"
                fontSize={10}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="hsl(215 20% 55%)"
                fontSize={11}
                tickFormatter={(v: number) => `${v.toLocaleString()}`}
                width={65}
              />
              <Tooltip
                {...chartTooltipStyle}
                formatter={(value: number) => [
                  `${value.toLocaleString()} MW`,
                  "Load",
                ]}
              />
              <Line
                type="monotone"
                dataKey="mw"
                name="Load"
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
