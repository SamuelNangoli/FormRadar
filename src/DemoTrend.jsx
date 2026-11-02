import React from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  XAxis,
} from "recharts";

export default function DemoTrend({ probabilities, period }) {
  return (
    <ResponsiveContainer width="100%" height={132}>
      <AreaChart
        data={Array.from(
          { length: period === "24H" ? 8 : period === "7D" ? 12 : 16 },
          (_, i) => ({
            n: i,
            value: probabilities[0] - 4 + Math.sin(i * 0.85) * 2 + i * 0.3,
          }),
        )}
      >
        <defs>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#36d99b" stopOpacity={0.24} />
            <stop offset="100%" stopColor="#36d99b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke="#233044"
          strokeDasharray="3 4"
        />
        <XAxis dataKey="n" hide />
        <Tooltip
          contentStyle={{
            background: "#172438",
            border: "1px solid #33445c",
            borderRadius: 10,
          }}
          formatter={(v) => [`${v.toFixed(1)}%`, "Demo probability"]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#39d99a"
          strokeWidth={2.5}
          fill="url(#fade)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
