"use client";

/**
 * WeeklyPerformance — self-contained weekly reporting section.
 *
 * Mirrors the manual "Spend Distribution on Media type" + "Week Wise
 * Performance" sheets: N consecutive 7-day buckets ending at a chosen anchor
 * date, each split into Inhouse vs Parent creatives (ad-level data, classified
 * by @/lib/creativeTypes) with a Total row per week.
 *
 * Owns its own fetch (`/api/meta/weekly`) so the week window is independent of
 * the dashboard's date preset — changing "Last 30 Days" up top does not move
 * these weeks. All aggregation goes through @/lib/metrics.
 */

import { useEffect, useMemo, useState } from "react";
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    LabelList,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import StaleNotice, { staleSince } from "@/components/StaleNotice";
import { useNearViewport } from "@/lib/useNearViewport";

import {
    CreativeBucket,
    WeekBreakdown,
    aggregateWeeklyByCreative,
    formatCompactINR,
    formatCurrency,
    formatNumber,
    formatPercent,
    formatRoas,
} from "@/lib/metrics";
import { classifyCreative } from "@/lib/creativeTypes";
import { useChartTheme } from "@/lib/useChartTheme";
import { WeeklyAdsData } from "@/types/meta";

const WEEK_OPTIONS = [2, 4, 6, 8, 12] as const;

/** Local YYYY-MM-DD (no UTC conversion — same rule as the server). */
function localYMD(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function yesterdayYMD(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localYMD(d);
}

/** Metric cells for one creative bucket, in the sheet's column order. */
function BucketCells({ b, bold = false }: { b: CreativeBucket; bold?: boolean }) {
    const cls = `tnum whitespace-nowrap px-4 py-2.5 text-right ${
        bold ? "font-semibold text-ink" : "text-ink-secondary"
    }`;
    return (
        <>
            <td className={cls}>{formatCurrency(b.spend, 0)}</td>
            <td className={cls}>{formatNumber(b.purchases)}</td>
            <td className={cls}>{formatCurrency(b.revenue, 0)}</td>
            <td className={cls}>{formatRoas(b.roas)}</td>
            <td className={cls}>{formatNumber(b.impressions)}</td>
            <td className={cls}>{formatNumber(b.clicks)}</td>
            <td className={cls}>{formatNumber(b.landingViews)}</td>
            <td className={cls}>{formatNumber(b.addToCart)}</td>
            <td className={cls}>{formatNumber(b.checkoutInitiated)}</td>
            <td className={cls}>{formatPercent(b.ctr)}</td>
            <td className={cls}>{formatPercent(b.clicksToLpv)}</td>
        </>
    );
}

const HEADER_COLS = [
    "Cost",
    "Purchases",
    "Revenue",
    "ROAS",
    "Impressions",
    "Clicks",
    "LPV",
    "ATC",
    "CI",
    "CTR",
    "Clicks → LPV",
] as const;

export default function WeeklyPerformance() {
    const [weeks, setWeeks] = useState(4);
    // Anchor = last day of the newest week. Defaults to yesterday (the most
    // recent COMPLETE day) so the newest bucket isn't a partial day.
    const [anchor, setAnchor] = useState(yesterdayYMD);
    const [data, setData] = useState<WeeklyAdsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stale, setStale] = useState<number | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    const t = useChartTheme();
    const [rootRef, near] = useNearViewport<HTMLDivElement>();

    useEffect(() => {
        // Lazy: wait until the section is about to be seen.
        if (!near) return;
        let ignore = false;

        async function load() {
            setLoading(true);
            try {
                const res = await fetch(
                    `/api/meta/weekly?anchor=${anchor}&weeks=${weeks}`
                );
                const json = await res.json();
                if (ignore) return;

                if (Array.isArray(json?.ads)) {
                    setData(json);
                    setError(null);
                    setStale(staleSince(res));
                } else {
                    setData(null);
                    setStale(null);
                    setError(
                        json?.error?.message ??
                            "The Meta API returned an unexpected response."
                    );
                }
            } catch (err) {
                if (ignore) return;
                console.error(err);
                setData(null);
                setStale(null);
                setError(
                    "Could not reach the dashboard API. Check your connection and try again."
                );
            } finally {
                if (!ignore) setLoading(false);
            }
        }

        load();
        return () => {
            ignore = true;
        };
    }, [anchor, weeks, reloadKey, near]);

    const breakdown: WeekBreakdown[] = useMemo(
        () => aggregateWeeklyByCreative(data?.ads ?? [], classifyCreative),
        [data]
    );

    // Week-wise chart/table rows: sheet-style "Week N" naming, oldest first.
    const weekWise = useMemo(
        () =>
            breakdown.map((w, i) => ({
                name: `Week ${i + 1}`,
                label: w.label,
                spend: w.total.spend,
                revenue: w.total.revenue,
                roi: w.total.roas,
            })),
        [breakdown]
    );

    const controls = (
        <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-medium text-ink-muted">
                Weeks
                <select
                    value={weeks}
                    onChange={(e) => setWeeks(Number(e.target.value))}
                    className="rounded-[10px] border border-hairline bg-surface px-2.5 py-2 text-sm font-medium text-ink-secondary transition-colors hover:border-hairline-strong focus:outline-none"
                >
                    {WEEK_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                            {n}
                        </option>
                    ))}
                </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-ink-muted">
                Ending
                <input
                    type="date"
                    value={anchor}
                    max={localYMD(new Date())}
                    onChange={(e) => e.target.value && setAnchor(e.target.value)}
                    className="rounded-[10px] border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink-secondary transition-colors hover:border-hairline-strong focus:outline-none"
                />
            </label>
        </div>
    );

    return (
        <div ref={rootRef} className="space-y-4">
            {!loading && !error && (
                <StaleNotice
                    since={stale}
                    onRetry={() => setReloadKey((k) => k + 1)}
                />
            )}

            {/* ── Media-type breakdown ─────────────────────────────── */}
            <div className="rounded-[var(--radius-card)] border border-hairline bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-ink">
                            Weekly Spend by Media Type
                        </h2>
                        <p className="mt-0.5 text-xs text-ink-muted">
                            {weeks} weeks ending {anchor} · Inhouse vs Parent
                            creatives (ad-level)
                        </p>
                    </div>
                    {controls}
                </div>

                {loading ? (
                    <div className="space-y-2 p-5">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div
                                key={i}
                                className="h-9 animate-pulse rounded-lg bg-surface-2"
                            />
                        ))}
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center gap-3 p-8 text-center">
                        <AlertTriangle size={20} className="text-warning" />
                        <p className="text-sm text-ink-secondary">{error}</p>
                        <button
                            type="button"
                            onClick={() => setReloadKey((k) => k + 1)}
                            className="rounded-[10px] border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-hairline-strong"
                        >
                            Try again
                        </button>
                    </div>
                ) : breakdown.length === 0 ? (
                    <p className="p-8 text-center text-sm text-ink-muted">
                        No delivery in this window. Try an earlier end date.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr>
                                    <th className="sticky left-0 z-20 whitespace-nowrap border-b border-hairline bg-surface px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                                        Week
                                    </th>
                                    <th className="whitespace-nowrap border-b border-hairline bg-surface px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                                        Creative
                                    </th>
                                    {HEADER_COLS.map((h) => (
                                        <th
                                            key={h}
                                            className="whitespace-nowrap border-b border-hairline bg-surface px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-ink-muted"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {breakdown.map((w) => (
                                    <WeekRows key={w.since} week={w} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Week-wise performance ────────────────────────────── */}
            {!loading && !error && weekWise.length > 0 && (
                <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
                    <div className="mb-5">
                        <h2 className="text-base font-semibold text-ink">
                            Week Wise Performance
                        </h2>
                        <p className="mt-0.5 text-xs text-ink-muted">
                            Totals per week · ROI = revenue ÷ spend
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                        {/* Summary table */}
                        <div className="lg:col-span-2">
                            <table className="w-full border-collapse text-sm">
                                <thead>
                                    <tr>
                                        {["Week", "Spends", "Revenue", "ROI"].map(
                                            (h, i) => (
                                                <th
                                                    key={h}
                                                    className={`whitespace-nowrap border-b border-hairline px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted ${
                                                        i === 0
                                                            ? "text-left"
                                                            : "text-right"
                                                    }`}
                                                >
                                                    {h}
                                                </th>
                                            )
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {weekWise.map((w) => (
                                        <tr
                                            key={w.name}
                                            className="border-b border-hairline transition-colors hover:bg-surface-2"
                                        >
                                            <td className="whitespace-nowrap px-4 py-2.5 text-left">
                                                <span className="font-medium text-ink">
                                                    {w.name}
                                                </span>
                                                <span className="ml-2 text-xs text-ink-muted">
                                                    {w.label}
                                                </span>
                                            </td>
                                            <td className="tnum whitespace-nowrap px-4 py-2.5 text-right text-ink-secondary">
                                                {formatCompactINR(w.spend)}
                                            </td>
                                            <td className="tnum whitespace-nowrap px-4 py-2.5 text-right text-ink-secondary">
                                                {formatCompactINR(w.revenue)}
                                            </td>
                                            <td className="tnum whitespace-nowrap px-4 py-2.5 text-right font-semibold text-ink">
                                                {formatRoas(w.roi)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Combo chart: spend/revenue bars + ROI line */}
                        <div className="lg:col-span-3">
                            <div className="mb-3 flex items-center justify-end gap-4">
                                <LegendDot color={t.series1} label="Spends" />
                                <LegendDot color={t.series2} label="Revenue" />
                                <LegendDot color={t.series3} label="ROI" />
                            </div>
                            <ResponsiveContainer width="100%" height={300}>
                                <ComposedChart
                                    data={weekWise}
                                    margin={{ top: 24, right: 8, left: 4, bottom: 4 }}
                                >
                                    <CartesianGrid
                                        strokeDasharray="3 3"
                                        stroke={t.grid}
                                        vertical={false}
                                    />
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fill: t.axis, fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        yAxisId="inr"
                                        tickFormatter={formatCompactINR}
                                        tick={{ fill: t.axis, fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={56}
                                    />
                                    <YAxis
                                        yAxisId="roi"
                                        orientation="right"
                                        tick={{ fill: t.axis, fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={36}
                                    />
                                    <Tooltip
                                        cursor={{ fill: "transparent" }}
                                        contentStyle={{
                                            background: t.surface,
                                            border: `1px solid ${t.grid}`,
                                            borderRadius: 10,
                                            fontSize: 12,
                                        }}
                                        labelStyle={{ color: t.ink }}
                                        formatter={(value, name) =>
                                            name === "ROI"
                                                ? [formatRoas(Number(value)), name]
                                                : [
                                                      formatCurrency(Number(value)),
                                                      name,
                                                  ]
                                        }
                                    />
                                    <Bar
                                        yAxisId="inr"
                                        dataKey="spend"
                                        name="Spends"
                                        fill={t.series1}
                                        radius={[4, 4, 0, 0]}
                                        maxBarSize={44}
                                    >
                                        <LabelList
                                            dataKey="spend"
                                            position="top"
                                            formatter={(v: unknown) =>
                                                formatCompactINR(Number(v))
                                            }
                                            fill={t.inkMuted}
                                            fontSize={10}
                                        />
                                    </Bar>
                                    <Bar
                                        yAxisId="inr"
                                        dataKey="revenue"
                                        name="Revenue"
                                        fill={t.series2}
                                        radius={[4, 4, 0, 0]}
                                        maxBarSize={44}
                                    >
                                        <LabelList
                                            dataKey="revenue"
                                            position="top"
                                            formatter={(v: unknown) =>
                                                formatCompactINR(Number(v))
                                            }
                                            fill={t.inkMuted}
                                            fontSize={10}
                                        />
                                    </Bar>
                                    <Line
                                        yAxisId="roi"
                                        type="monotone"
                                        dataKey="roi"
                                        name="ROI"
                                        stroke={t.series3}
                                        strokeWidth={2}
                                        dot={{ r: 3, strokeWidth: 0, fill: t.series3 }}
                                    />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** One week = Inhouse row + Parent row + bold Total row (sheet layout). */
function WeekRows({ week }: { week: WeekBreakdown }) {
    return (
        <>
            <tr className="border-b border-hairline transition-colors hover:bg-surface-2">
                <td
                    rowSpan={2}
                    className="sticky left-0 z-10 whitespace-nowrap bg-surface px-4 py-2.5 text-left font-medium text-ink"
                >
                    {week.label}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-left text-ink-secondary">
                    Inhouse
                </td>
                <BucketCells b={week.inhouse} />
            </tr>
            <tr className="border-b border-hairline transition-colors hover:bg-surface-2">
                <td className="whitespace-nowrap px-4 py-2.5 text-left text-ink-secondary">
                    Parent
                </td>
                <BucketCells b={week.parent} />
            </tr>
            <tr className="border-b border-hairline-strong bg-surface-2">
                <td
                    colSpan={2}
                    className="sticky left-0 z-10 whitespace-nowrap bg-surface-2 px-4 py-2.5 text-left font-semibold text-ink"
                >
                    {week.label} Total
                </td>
                <BucketCells b={week.total} bold />
            </tr>
        </>
    );
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
