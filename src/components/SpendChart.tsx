"use client";

import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
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

/** Compact ₹ for axis ticks (₹1.2L, ₹3.4Cr). */
function compactINR(value: number): string {
    return `₹${value.toLocaleString("en-IN", {
        notation: "compact",
        maximumFractionDigits: 1,
    })}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
            <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: color }}
            />
            {label}
        </span>
    );
}

export default function SpendChart({ data }: Props) {
    const t = useChartTheme();

    return (
        <ChartCard
            title="Revenue vs Spend"
            subtitle="Daily totals across all campaigns"
            action={
                <div className="flex items-center gap-4">
                    <LegendDot color={t.series2} label="Revenue" />
                    <LegendDot color={t.series1} label="Spend" />
                </div>
            }
        >
            <ResponsiveContainer width="100%" height={340}>
                <AreaChart
                    data={data}
                    margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                >
                    <defs>
                        <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={t.series2} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={t.series2} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fillSpend" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={t.series1} stopOpacity={0.28} />
                            <stop offset="100%" stopColor={t.series1} stopOpacity={0} />
                        </linearGradient>
                    </defs>

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
                        tickFormatter={compactINR}
                        tick={{ fill: t.axis, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        width={56}
                    />
                    <Tooltip
                        content={<ChartTooltip format="currency" />}
                        cursor={{ stroke: t.grid, strokeWidth: 1 }}
                    />

                    <Area
                        type="monotone"
                        dataKey="revenue"
                        name="Revenue"
                        stroke={t.series2}
                        strokeWidth={2}
                        fill="url(#fillRevenue)"
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                    <Area
                        type="monotone"
                        dataKey="spend"
                        name="Spend"
                        stroke={t.series1}
                        strokeWidth={2}
                        fill="url(#fillSpend)"
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </ChartCard>
    );
}
