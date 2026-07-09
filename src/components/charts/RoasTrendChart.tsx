"use client";

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
    ReferenceLine,
} from "recharts";

import { DailyMetricPoint } from "@/lib/metrics";
import { useChartTheme } from "@/lib/useChartTheme";
import ChartCard from "@/components/charts/ChartCard";
import ChartTooltip from "@/components/charts/ChartTooltip";

type Props = {
    data: DailyMetricPoint[];
};

function shortDate(value: string): string {
    return new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
    });
}

/** Daily ROAS with a break-even reference line at 1.0. */
export default function RoasTrendChart({ data }: Props) {
    const t = useChartTheme();

    return (
        <ChartCard title="Daily ROAS" subtitle="Return on ad spend · break-even at 1.0×">
            <ResponsiveContainer width="100%" height={260}>
                <LineChart
                    data={data}
                    margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                >
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={t.grid}
                        vertical={false}
                    />
                    <XAxis
                        dataKey="date"
                        tickFormatter={shortDate}
                        tick={{ fill: t.axis, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={24}
                    />
                    <YAxis
                        tickFormatter={(v) => `${v.toFixed(1)}×`}
                        tick={{ fill: t.axis, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                    />
                    <ReferenceLine
                        y={1}
                        stroke={t.axis}
                        strokeDasharray="4 4"
                        strokeOpacity={0.6}
                    />
                    <Tooltip
                        content={<ChartTooltip format="roas" />}
                        cursor={{ stroke: t.grid, strokeWidth: 1 }}
                    />
                    <Line
                        type="monotone"
                        dataKey="roas"
                        name="ROAS"
                        stroke={t.series3}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </ChartCard>
    );
}
