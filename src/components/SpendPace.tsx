"use client";

/**
 * Spend pace — today so far vs yesterday at the same time of day, with a
 * projected end-of-day spend and a cumulative chart. Independent of the header's
 * date range (it is always "today vs yesterday"). Owns its fetch
 * (`/api/meta/pace`) and refreshes itself every few minutes while open.
 */

import { useEffect, useMemo, useState } from "react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { Gauge, IndianRupee, ShoppingCart, TrendingUp } from "lucide-react";

import ChartCard from "@/components/charts/ChartCard";
import KPICard, { KpiDelta, pctChange } from "@/components/KPICard";
import StaleNotice, { staleSince } from "@/components/StaleNotice";
import { MIN_PURCHASES_TO_COMPARE, computePace } from "@/lib/pace";
import {
    formatCurrency,
    formatNumber,
    formatRoas,
} from "@/lib/metrics";
import { useChartTheme } from "@/lib/useChartTheme";
import { PaceData } from "@/types/meta";

const REFRESH_EVERY_MS = 5 * 60 * 1000;

/** "12 am", "6 am", "3 pm" for an hour 0-23. */
function hourLabel(h: number): string {
    return `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
}

function clock(hour: number, minute: number): string {
    return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** Compact ₹ for axis ticks. */
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

interface Props {
    /** Bump to reload (wired to the header's Refresh button). */
    refreshKey: number;
}

export default function SpendPace({ refreshKey }: Props) {
    const t = useChartTheme();
    const [data, setData] = useState<PaceData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stale, setStale] = useState<number | null>(null);
    const [tick, setTick] = useState(0);

    // Re-poll while the page is open: "today" keeps moving.
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), REFRESH_EVERY_MS);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        let ignore = false;

        async function load() {
            try {
                const res = await fetch("/api/meta/pace");
                const json = await res.json();
                if (ignore) return;

                if (Array.isArray(json?.todayHours)) {
                    setData(json);
                    setError(null);
                    setStale(staleSince(res));
                } else {
                    setError(
                        json?.error?.message ??
                            "The Meta API returned an unexpected response."
                    );
                }
            } catch (err) {
                if (ignore) return;
                console.error(err);
                setError("Could not reach the dashboard API.");
            } finally {
                if (!ignore) setLoading(false);
            }
        }

        load();
        return () => {
            ignore = true;
        };
    }, [refreshKey, tick]);

    const pace = useMemo(() => (data ? computePace(data) : null), [data]);

    // Nothing to show yet, or it failed with nothing cached: keep it quiet so a
    // pace hiccup never competes with the main KPIs.
    if (loading) {
        return (
            <div className="h-[220px] animate-pulse rounded-[var(--radius-card)] border border-hairline bg-surface" />
        );
    }
    if (!data || !pace) {
        return (
            <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5 text-sm text-ink-secondary">
                Couldn&apos;t load today&apos;s spend pace{error ? `: ${error}` : "."}
            </div>
        );
    }

    const label = "vs yesterday by now";
    const delta = (
        current: number,
        previous: number,
        good: KpiDelta["good"]
    ): KpiDelta => ({ pct: pctChange(current, previous), good, label });

    const { today, yesterdayToNow, yesterdayTotal, projectedSpend } = pace;
    // Too few purchases yet for a meaningful comparison (see pace.ts).
    const enoughVolume = yesterdayToNow.purchases >= MIN_PURCHASES_TO_COMPARE;
    const projectedDelta =
        projectedSpend !== null
            ? {
                  pct: pctChange(projectedSpend, yesterdayTotal.spend),
                  good: "neutral" as const,
                  label: "vs yesterday total",
              }
            : undefined;

    return (
        <div className="space-y-4">
            <StaleNotice since={stale} onRetry={() => setTick((n) => n + 1)} />

            <ChartCard
                title="Spend pace: today vs yesterday"
                subtitle={`As of ${clock(data.hour, data.minute)} (${data.timezone}). Meta's hourly numbers can lag by up to an hour, so the newest hour reads a little low.`}
                action={
                    <div className="flex items-center gap-4">
                        <LegendDot color={t.series1} label="Today" />
                        <LegendDot color={t.axis} label="Yesterday" />
                    </div>
                }
            >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <KPICard
                        title="Spent so far"
                        value={formatCurrency(today.spend, 0)}
                        hint={`Yesterday by now: ${formatCurrency(yesterdayToNow.spend, 0)}`}
                        delta={delta(today.spend, yesterdayToNow.spend, "neutral")}
                        accent="var(--series-1)"
                        icon={<IndianRupee size={18} />}
                    />
                    <KPICard
                        title="Projected today"
                        value={
                            projectedSpend !== null
                                ? formatCurrency(projectedSpend, 0)
                                : "Too early"
                        }
                        hint={
                            projectedSpend !== null
                                ? `Yesterday total: ${formatCurrency(yesterdayTotal.spend, 0)}`
                                : "Needs a few hours of data to project"
                        }
                        delta={projectedDelta}
                        accent="var(--series-4)"
                        icon={<Gauge size={18} />}
                    />
                    <KPICard
                        title="Purchases so far"
                        value={formatNumber(today.purchases)}
                        hint={
                            enoughVolume
                                ? `Yesterday by now: ${formatNumber(yesterdayToNow.purchases, 1)}`
                                : "Too early to compare: few purchases so far"
                        }
                        delta={
                            enoughVolume
                                ? delta(today.purchases, yesterdayToNow.purchases, "up")
                                : undefined
                        }
                        accent="var(--series-3)"
                        icon={<ShoppingCart size={18} />}
                    />
                    <KPICard
                        title="ROAS so far"
                        value={`${formatRoas(today.roas)}×`}
                        hint={
                            enoughVolume
                                ? `Yesterday by now: ${formatRoas(yesterdayToNow.roas)}×`
                                : "Too early to compare: few purchases so far"
                        }
                        delta={
                            enoughVolume
                                ? delta(today.roas, yesterdayToNow.roas, "up")
                                : undefined
                        }
                        accent="var(--positive)"
                        icon={<TrendingUp size={18} />}
                    />
                </div>

                <div className="mt-5">
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart
                            data={pace.series}
                            margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                        >
                            <defs>
                                <linearGradient id="fillPaceToday" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={t.series1} stopOpacity={0.3} />
                                    <stop offset="100%" stopColor={t.series1} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid
                                strokeDasharray="3 3"
                                stroke={t.grid}
                                vertical={false}
                            />
                            <XAxis
                                dataKey="hour"
                                tickFormatter={hourLabel}
                                tick={{ fill: t.axis, fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                interval={3}
                            />
                            <YAxis
                                tickFormatter={compactINR}
                                tick={{ fill: t.axis, fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                width={56}
                            />
                            <Tooltip
                                cursor={{ stroke: t.grid, strokeWidth: 1 }}
                                content={<PaceTooltip />}
                            />
                            <ReferenceLine
                                x={data.hour}
                                stroke={t.axis}
                                strokeDasharray="4 4"
                            />
                            <Area
                                type="monotone"
                                dataKey="yesterday"
                                name="Yesterday"
                                stroke={t.axis}
                                strokeWidth={2}
                                strokeDasharray="5 4"
                                fill="none"
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 0 }}
                            />
                            <Area
                                type="monotone"
                                dataKey="today"
                                name="Today"
                                stroke={t.series1}
                                strokeWidth={2}
                                fill="url(#fillPaceToday)"
                                dot={false}
                                connectNulls={false}
                                activeDot={{ r: 4, strokeWidth: 0 }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </ChartCard>
        </div>
    );
}

interface TooltipProps {
    active?: boolean;
    label?: number;
    payload?: { name?: string; value?: number | null; color?: string }[];
}

/** Hour + cumulative spend for each line (skips today's not-yet-reached hours). */
function PaceTooltip({ active, label, payload }: TooltipProps) {
    if (!active || !payload?.length || label === undefined) return null;
    const rows = payload.filter((p) => typeof p.value === "number");
    return (
        <div className="rounded-[10px] border border-hairline bg-surface-2 px-3 py-2 text-xs shadow-xl">
            <p className="mb-1 font-medium text-ink">
                By end of {hourLabel(label)} hour
            </p>
            {rows.map((p) => (
                <p key={p.name} className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-ink-secondary">
                        <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: p.color }}
                        />
                        {p.name}
                    </span>
                    <span className="tnum font-medium text-ink">
                        {formatCurrency(p.value as number, 0)}
                    </span>
                </p>
            ))}
        </div>
    );
}
