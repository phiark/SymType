import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardData } from "../types";

export default function TodayTrendChart({ trend }: { trend: DashboardData["trend"] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={trend}>
        <defs>
          <linearGradient id="todayTrend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity={0.28} />
            <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="local_date"
          tickFormatter={(value: string) => value.slice(5)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide domain={[0, "auto"]} />
        <Tooltip formatter={(value) => [`${Math.round(Number(value))} WPM`, "净速度"]} />
        <Area
          type="monotone"
          dataKey="net_wpm"
          stroke="var(--accent)"
          strokeWidth={2.2}
          fill="url(#todayTrend)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
