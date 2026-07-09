"use client";

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from "recharts";

import { CampaignAggregate, formatCurrency } from "@/lib/metrics";
import { useChartTheme } from "@/lib/useChartTheme";
import ChartCard from "@/components/charts/ChartCard";

type Props = {
    campaigns: CampaignAggregate[];
    limit?: number;
};

function truncate(name: string, max = 22): string {
    return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/** Top campaigns by spend — where the budget goes. Single-hue bars. */
export default function SpendDistribution({ campaigns, limit = 6 }: Props) {
    const t = useChartTheme();

    const rows = [...campaigns]
        .sort((a, b) => b.spend - a.spend)
        .slice(0, limit)
        .map((c) => ({
            name: truncate(c.campaign_name),
            fullName: c.campaign_name,
            spend: c.spend,
        }));

    return (
        <ChartCard title="Spend Distribution" subtitle={`Top ${rows.length} campaigns by spend`}>
            <ResponsiveContainer width="100%" height={260}>
                <BarChart
                    data={rows}
                    layout="vertical"
                    margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
                    barCategoryGap="28%"
                >
                    <XAxis type="number" hide />
                    <YAxis
                        type="category"
                        dataKey="name"
                        width={150}
                        tick={{ fill: t.inkMuted, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip
                        cursor={{ fill: t.grid }}
                        content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0].payload as {
                                fullName: string;
                                spend: number;
                            };
                            return (
                                <div className="glass max-w-64 rounded-[10px] px-3 py-2 shadow-xl">
                                    <p className="text-xs text-ink-secondary">
                                        {row.fullName}
                                    </p>
                                    <p className="tnum mt-0.5 text-sm font-semibold text-ink">
                                        {formatCurrency(row.spend)}
                                    </p>
                                </div>
                            );
                        }}
                    />
                    <Bar dataKey="spend" radius={[0, 4, 4, 0]} maxBarSize={22}>
                        {rows.map((_, i) => (
                            <Cell key={i} fill={t.series1} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </ChartCard>
    );
}
