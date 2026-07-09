"use client";

import { FunnelStage, formatNumber } from "@/lib/metrics";
import { useChartTheme } from "@/lib/useChartTheme";
import ChartCard from "@/components/charts/ChartCard";

type Props = {
    stages: FunnelStage[];
};

/** Extra precision for small percentages so e.g. 0.02% doesn't round to "0.0%". */
function formatPct(value: number): string {
    return `${value.toFixed(value < 1 ? 2 : 1)}%`;
}

/**
 * Conversion funnel: Impressions → Clicks → Landing Page Views → Add to Cart
 * → Checkout Initiated → Purchases. Built entirely from fields already
 * fetched from Meta (impressions, clicks, actions) — no extra API calls.
 *
 * Ordinal one-hue ramp (light→dark) per stage; bars scale to the first stage
 * so width itself carries magnitude — color reinforces order, not identity,
 * so no legend is needed. Each bar is directly labeled (stage, count, and
 * % of previous / % of first), satisfying the "no color-only meaning" rule.
 */
export default function FunnelChart({ stages }: Props) {
    const t = useChartTheme();

    if (stages.length === 0 || stages[0].value === 0) {
        return (
            <ChartCard title="Conversion Funnel" subtitle="Impressions to purchase">
                <p className="py-10 text-center text-sm text-ink-muted">
                    No funnel data for this range.
                </p>
            </ChartCard>
        );
    }

    const max = stages[0].value;

    return (
        <ChartCard
            title="Conversion Funnel"
            subtitle="Impressions → clicks → landing views → cart → checkout → purchase"
        >
            <div className="flex flex-col gap-3">
                {stages.map((stage, i) => {
                    const widthPct = Math.max(4, (stage.value / max) * 100);
                    const color = t.funnel[i] ?? t.funnel[t.funnel.length - 1];
                    return (
                        <div key={stage.key} className="flex items-center gap-4">
                            <div className="w-40 flex-shrink-0 text-right text-xs font-medium text-ink-secondary">
                                {stage.label}
                            </div>
                            <div className="relative flex-1">
                                <div
                                    className="flex h-9 items-center rounded-[4px] pl-3 transition-[width] duration-500"
                                    style={{
                                        width: `${widthPct}%`,
                                        background: color,
                                    }}
                                >
                                    <span className="tnum text-xs font-semibold text-white drop-shadow-sm">
                                        {formatNumber(stage.value)}
                                    </span>
                                </div>
                            </div>
                            <div className="w-32 flex-shrink-0 text-right">
                                {stage.pctOfPrevious !== null && (
                                    <p className="tnum text-xs font-semibold text-ink">
                                        {formatPct(stage.pctOfPrevious)}
                                        <span className="ml-1 font-normal text-ink-muted">
                                            of prev
                                        </span>
                                    </p>
                                )}
                                <p className="tnum text-[11px] text-ink-muted">
                                    {formatPct(stage.pctOfFirst)} of total
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </ChartCard>
    );
}
