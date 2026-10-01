/**
 * pace.ts — "how is today going compared with yesterday?" math.
 *
 * Pure functions over the hourly data from `/api/meta/pace`. The comparison is
 * like-for-like: today so far vs yesterday up to the SAME moment of the day (the
 * current hour is pro-rated by the minutes elapsed), not vs yesterday's full
 * total, which would make every morning look like a collapse.
 */

import { PaceData, PaceHour } from "@/types/meta";
import { deriveRoas, safeDivide } from "@/lib/metrics";

/** Below this share of yesterday's day elapsed, a projection is too noisy. */
export const MIN_SHARE_TO_PROJECT = 0.1;

/**
 * Purchases (and so ROAS) are lumpy early in the day: 0 vs 2 is "-100%" but means
 * nothing. Only compare them once yesterday had at least this many by now.
 */
export const MIN_PURCHASES_TO_COMPARE = 5;

export interface PaceTotals {
    spend: number;
    purchases: number;
    revenue: number;
    roas: number;
}

export interface PacePoint {
    /** 0-23 */
    hour: number;
    /** Cumulative spend at the END of this hour, yesterday. */
    yesterday: number;
    /** Cumulative spend so far today; null for hours not reached yet. */
    today: number | null;
}

export interface Pace {
    /** Today so far. */
    today: PaceTotals;
    /** Yesterday up to the same moment. */
    yesterdayToNow: PaceTotals;
    /** Yesterday, whole day. */
    yesterdayTotal: PaceTotals;
    /** Share of yesterday's spend that had happened by now (0-1). */
    share: number;
    /** Projected end-of-day spend at yesterday's pattern; null when too early. */
    projectedSpend: number | null;
    series: PacePoint[];
}

function totals(hours: { spend: number; purchases: number; revenue: number }[]): PaceTotals {
    let spend = 0;
    let purchases = 0;
    let revenue = 0;
    for (const h of hours) {
        spend += h.spend;
        purchases += h.purchases;
        revenue += h.revenue;
    }
    return { spend, purchases, revenue, roas: deriveRoas(revenue, spend) };
}

/** 24 slots, hours Meta omitted (no spend) filled with zeros. */
function fill(hours: PaceHour[]): PaceHour[] {
    const byHour = new Map(hours.map((h) => [h.h, h]));
    return Array.from(
        { length: 24 },
        (_, h) => byHour.get(h) ?? { h, spend: 0, purchases: 0, revenue: 0 }
    );
}

export function computePace(data: PaceData): Pace {
    const today = fill(data.todayHours);
    const yesterday = fill(data.yesterdayHours);
    const { hour, minute } = data;

    // Today: every hour up to and including the current (partial) one.
    const todaySoFar = totals(today.filter((h) => h.h <= hour));

    // Yesterday at the same moment: full hours before now, plus the elapsed
    // fraction of the current hour.
    const frac = minute / 60;
    const yesterdayToNow = totals([
        ...yesterday.filter((h) => h.h < hour),
        {
            spend: yesterday[hour].spend * frac,
            purchases: yesterday[hour].purchases * frac,
            revenue: yesterday[hour].revenue * frac,
        },
    ]);

    const yesterdayTotal = totals(yesterday);
    const share = safeDivide(yesterdayToNow.spend, yesterdayTotal.spend);
    const projectedSpend =
        share >= MIN_SHARE_TO_PROJECT && todaySoFar.spend > 0
            ? todaySoFar.spend / share
            : null;

    let yCum = 0;
    let tCum = 0;
    const series: PacePoint[] = Array.from({ length: 24 }, (_, h) => {
        yCum += yesterday[h].spend;
        if (h <= hour) tCum += today[h].spend;
        return { hour: h, yesterday: yCum, today: h <= hour ? tCum : null };
    });

    return {
        today: todaySoFar,
        yesterdayToNow,
        yesterdayTotal,
        share,
        projectedSpend,
        series,
    };
}
