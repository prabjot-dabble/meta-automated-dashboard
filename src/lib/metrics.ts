/**
 * metrics.ts — the single source of truth for every business calculation.
 *
 * The Meta API is queried with `time_increment=1`, so each `MetaCampaign` row
 * is a **campaign-day**, not a whole campaign. Anything that needs a
 * per-campaign or account-level view MUST go through the aggregation helpers
 * here — never treat a raw row as a campaign.
 *
 * Rules encoded in this file:
 *   • Additive metrics (spend, revenue, purchases, impressions, clicks, reach)
 *     are SUMMED across rows.
 *   • Ratio metrics (ROAS, CTR, CPC, CPM, cost-per-purchase) are DERIVED from
 *     the summed totals — never averaged across rows/campaigns.
 *   • Purchase count / value / ROAS come from a single canonical action type,
 *     chosen deterministically by priority (see PURCHASE_ACTION_TYPE_PRIORITY),
 *     never summed across overlapping types (that would double-count).
 *
 * Every KPI, chart, table and insight imports from this module so that all
 * surfaces reconcile with one another and with Meta Ads Manager.
 */

import { MetaAction, MetaAdRow, MetaCampaign } from "@/types/meta";

/* ────────────────────────────────────────────────────────────────────────
 * Canonical purchase configuration
 *
 * Meta returns several overlapping purchase action types on the same row
 * (e.g. `omni_purchase` — the unified metric — plus its subset
 * `offsite_conversion.fb_pixel_purchase`). Summing them double-counts, and the
 * previous code's `.find()` picked whichever appeared first in the array,
 * making the result depend on Meta's (unspecified) ordering.
 *
 * Instead we pick ONE canonical type, in priority order: the first type in
 * this list that is present on the row wins. `omni_purchase` matches the
 * default "Purchases" column in Ads Manager for most accounts. To report on a
 * different definition, reorder or edit this single constant.
 * ──────────────────────────────────────────────────────────────────────── */
export const PURCHASE_ACTION_TYPE_PRIORITY = [
    "omni_purchase",
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
] as const;

/* Mid-funnel events follow the same one-canonical-type-by-priority rule. */
export const LANDING_PAGE_VIEW_PRIORITY = [
    "landing_page_view",
    "omni_landing_page_view",
] as const;

export const ADD_TO_CART_PRIORITY = [
    "omni_add_to_cart",
    "add_to_cart",
    "offsite_conversion.fb_pixel_add_to_cart",
] as const;

export const INITIATE_CHECKOUT_PRIORITY = [
    "omni_initiated_checkout",
    "initiate_checkout",
    "offsite_conversion.fb_pixel_initiate_checkout",
] as const;

/**
 * 3-second video plays. Meta reports them as the `video_view` action; this is
 * the numerator of hook rate. (ThruPlays arrive in their own field, see
 * `getThruPlays`, and use the same `video_view` label.)
 */
export const VIDEO_VIEW_3S_PRIORITY = ["video_view"] as const;

/**
 * Every action type any metric above reads. The API routes keep ONLY these on
 * each row (Meta returns ~60 types per row; the rest are dead weight in the
 * cache and the browser payload). When you add a metric that reads a new action
 * type, put its priority list here so it survives the trim.
 */
export const TRACKED_ACTION_TYPES: readonly string[] = Array.from(
    new Set<string>([
        ...PURCHASE_ACTION_TYPE_PRIORITY,
        ...LANDING_PAGE_VIEW_PRIORITY,
        ...ADD_TO_CART_PRIORITY,
        ...INITIATE_CHECKOUT_PRIORITY,
        ...VIDEO_VIEW_3S_PRIORITY,
    ])
);

/**
 * Returns the numeric `value` of the first action whose `action_type` matches
 * the priority list — matched by priority order, NOT by array position — or 0
 * if none match / the array is absent. Deterministic regardless of how Meta
 * orders the array.
 */
export function pickCanonicalValue(
    actions: MetaAction[] | undefined,
    priority: readonly string[] = PURCHASE_ACTION_TYPE_PRIORITY
): number {
    if (!actions || actions.length === 0) return 0;

    for (const type of priority) {
        const match = actions.find((a) => a.action_type === type);
        if (match) return toNumber(match.value);
    }

    return 0;
}

/* ────────────────────────────────────────────────────────────────────────
 * Safe primitives
 * ──────────────────────────────────────────────────────────────────────── */

/** Coerces a Graph string/number to a finite number, or 0 for null/NaN/∞. */
export function toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/** Divides safely, returning 0 when the denominator is 0 (or non-finite). */
export function safeDivide(numerator: number, denominator: number): number {
    return denominator > 0 ? numerator / denominator : 0;
}

/* ────────────────────────────────────────────────────────────────────────
 * Per-row extractors (canonical purchase metrics)
 * ──────────────────────────────────────────────────────────────────────── */

/** Purchase conversion VALUE (revenue) for a single row, from `action_values`. */
export function getRevenue(campaign: MetaCampaign): number {
    return pickCanonicalValue(campaign.action_values);
}

/** Purchase COUNT for a single row, from `actions`. */
export function getPurchases(campaign: MetaCampaign): number {
    return pickCanonicalValue(campaign.actions);
}

/**
 * Meta's own reported ROAS for a single row, from `purchase_roas`.
 *
 * NOTE: this is Meta's per-row ratio and is only meaningful at the row level.
 * For any aggregate (campaign or account) ROAS, derive it from summed
 * revenue / spend via {@link deriveRoas} — do not average this value.
 */
export function getRowRoas(campaign: MetaCampaign): number {
    return pickCanonicalValue(campaign.purchase_roas);
}

/* ────────────────────────────────────────────────────────────────────────
 * Derived ratios (from summed totals)
 * ──────────────────────────────────────────────────────────────────────── */

/** 3-second video plays for a row (from `actions`). */
export function getVideoViews3s(row: MetaCampaign): number {
    return pickCanonicalValue(row.actions, VIDEO_VIEW_3S_PRIORITY);
}

/** ThruPlays (watched to 15s or to the end, whichever comes first). */
export function getThruPlays(row: MetaCampaign): number {
    return pickCanonicalValue(row.video_thruplay_watched_actions, VIDEO_VIEW_3S_PRIORITY);
}

/** Average seconds watched per video play. */
export function getAvgWatchSeconds(row: MetaCampaign): number {
    return pickCanonicalValue(row.video_avg_time_watched_actions, VIDEO_VIEW_3S_PRIORITY);
}

/**
 * Hook rate: share of impressions that watched at least 3 seconds (percent).
 * Says whether the opening of a video stops the scroll.
 */
export function deriveHookRate(views3s: number, impressions: number): number {
    return safeDivide(views3s, impressions) * 100;
}

/**
 * Hold rate: of the people who got past the hook, the share that watched to 15s
 * or the end (percent). Says whether the video keeps attention once it has it.
 */
export function deriveHoldRate(thruPlays: number, views3s: number): number {
    return safeDivide(thruPlays, views3s) * 100;
}

export function deriveRoas(revenue: number, spend: number): number {
    return safeDivide(revenue, spend);
}

/** CTR as a percentage: clicks / impressions * 100. */
export function deriveCtr(clicks: number, impressions: number): number {
    return safeDivide(clicks, impressions) * 100;
}

export function deriveCpc(spend: number, clicks: number): number {
    return safeDivide(spend, clicks);
}

/** CPM: cost per 1,000 impressions. */
export function deriveCpm(spend: number, impressions: number): number {
    return safeDivide(spend, impressions) * 1000;
}

export function deriveCostPerPurchase(spend: number, purchases: number): number {
    return safeDivide(spend, purchases);
}

/** Clicks → LPV rate as a percentage: landing page views / clicks * 100. */
export function deriveClicksToLpv(landingViews: number, clicks: number): number {
    return safeDivide(landingViews, clicks) * 100;
}

/* ────────────────────────────────────────────────────────────────────────
 * Campaign-level aggregation
 * ──────────────────────────────────────────────────────────────────────── */

export interface CampaignAggregate {
    campaign_id: string;
    campaign_name: string;

    // Summed (additive) metrics
    spend: number;
    revenue: number;
    purchases: number;
    impressions: number;
    clicks: number;
    reach: number;
    landingViews: number;
    addToCart: number;
    checkoutInitiated: number;

    // Derived (from the summed totals above)
    roas: number;
    ctr: number;
    cpc: number;
    cpm: number;
    costPerPurchase: number;
    clicksToLpv: number;

    /** Number of distinct campaign-days aggregated into this campaign. */
    days: number;
}

/**
 * Groups campaign-day rows by `campaign_id`, sums additive metrics, and derives
 * ratios from those sums. Result is sorted by spend descending (most material
 * campaigns first). This is the correct unit for the table, rankings and any
 * per-campaign display.
 *
 * NOTE on `reach`: reach is a de-duplicated unique-users metric and is NOT
 * truly additive across days (the same person can be reached on multiple
 * days). Summing daily reach over-counts. We surface the summed value for
 * completeness but it should be read as "sum of daily reach", not unique
 * reach — true unique reach requires a separate non-time-incremented query.
 */
export function aggregateByCampaign(rows: MetaCampaign[]): CampaignAggregate[] {
    const byId = new Map<string, CampaignAggregate>();

    for (const row of rows) {
        const id = row.campaign_id;
        let agg = byId.get(id);

        if (!agg) {
            agg = {
                campaign_id: id,
                campaign_name: row.campaign_name ?? "",
                spend: 0,
                revenue: 0,
                purchases: 0,
                impressions: 0,
                clicks: 0,
                reach: 0,
                landingViews: 0,
                addToCart: 0,
                checkoutInitiated: 0,
                roas: 0,
                ctr: 0,
                cpc: 0,
                cpm: 0,
                costPerPurchase: 0,
                clicksToLpv: 0,
                days: 0,
            };
            byId.set(id, agg);
        }

        agg.spend += toNumber(row.spend);
        agg.revenue += getRevenue(row);
        agg.purchases += getPurchases(row);
        agg.impressions += toNumber(row.impressions);
        agg.clicks += toNumber(row.clicks);
        agg.reach += toNumber(row.reach);
        agg.landingViews += pickCanonicalValue(row.actions, LANDING_PAGE_VIEW_PRIORITY);
        agg.addToCart += pickCanonicalValue(row.actions, ADD_TO_CART_PRIORITY);
        agg.checkoutInitiated += pickCanonicalValue(row.actions, INITIATE_CHECKOUT_PRIORITY);
        agg.days += 1;

        // Keep the most recent non-empty name we see.
        if (row.campaign_name) agg.campaign_name = row.campaign_name;
    }

    const result = Array.from(byId.values());

    for (const agg of result) {
        agg.roas = deriveRoas(agg.revenue, agg.spend);
        agg.ctr = deriveCtr(agg.clicks, agg.impressions);
        agg.cpc = deriveCpc(agg.spend, agg.clicks);
        agg.cpm = deriveCpm(agg.spend, agg.impressions);
        agg.costPerPurchase = deriveCostPerPurchase(agg.spend, agg.purchases);
        agg.clicksToLpv = deriveClicksToLpv(agg.landingViews, agg.clicks);
    }

    result.sort((a, b) => b.spend - a.spend);
    return result;
}

/**
 * "Active" is defined as **spent money in the selected date range**
 * (`spend > 0`), not Meta's current `effective_status`.
 *
 * This is intentional, not a shortcut: `effective_status` reflects a
 * campaign's state *right now* (at fetch time), not whether it delivered
 * during the reported period. Verified against a single-day Ads Manager
 * export (7 Jul 2026): 2 of 10 campaigns that spent money that day were
 * already marked "inactive" (paused sometime after delivering) — filtering
 * by current status would have silently dropped their real spend from a
 * historical view. Spend-based filtering is also computed entirely from data
 * already fetched, so it requires no additional Meta API fields or calls.
 */
export function filterActiveCampaigns(
    campaigns: CampaignAggregate[]
): CampaignAggregate[] {
    return campaigns.filter((c) => c.spend > 0);
}

/* ────────────────────────────────────────────────────────────────────────
 * Account-level totals (KPIs)
 * ──────────────────────────────────────────────────────────────────────── */

export interface AccountTotals {
    spend: number;
    revenue: number;
    purchases: number;
    impressions: number;
    clicks: number;
    reach: number;
    landingViews: number;
    addToCart: number;
    checkoutInitiated: number;

    roas: number;
    ctr: number;
    cpc: number;
    cpm: number;
    costPerPurchase: number;
    clicksToLpv: number;

    /** Count of DISTINCT campaigns (by campaign_id), not campaign-day rows. */
    campaignCount: number;
}

/**
 * Computes account-wide KPI totals directly from campaign-day rows. Additive
 * metrics are summed; ratios are derived from those sums (weighted, correct);
 * campaign count is the number of unique `campaign_id`s.
 */
export function computeTotals(rows: MetaCampaign[]): AccountTotals {
    const totals: AccountTotals = {
        spend: 0,
        revenue: 0,
        purchases: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        landingViews: 0,
        addToCart: 0,
        checkoutInitiated: 0,
        roas: 0,
        ctr: 0,
        cpc: 0,
        cpm: 0,
        costPerPurchase: 0,
        clicksToLpv: 0,
        campaignCount: 0,
    };

    const ids = new Set<string>();

    for (const row of rows) {
        totals.spend += toNumber(row.spend);
        totals.revenue += getRevenue(row);
        totals.purchases += getPurchases(row);
        totals.impressions += toNumber(row.impressions);
        totals.clicks += toNumber(row.clicks);
        totals.reach += toNumber(row.reach);
        totals.landingViews += pickCanonicalValue(row.actions, LANDING_PAGE_VIEW_PRIORITY);
        totals.addToCart += pickCanonicalValue(row.actions, ADD_TO_CART_PRIORITY);
        totals.checkoutInitiated += pickCanonicalValue(row.actions, INITIATE_CHECKOUT_PRIORITY);
        if (row.campaign_id) ids.add(row.campaign_id);
    }

    totals.roas = deriveRoas(totals.revenue, totals.spend);
    totals.ctr = deriveCtr(totals.clicks, totals.impressions);
    totals.cpc = deriveCpc(totals.spend, totals.clicks);
    totals.cpm = deriveCpm(totals.spend, totals.impressions);
    totals.costPerPurchase = deriveCostPerPurchase(totals.spend, totals.purchases);
    totals.clicksToLpv = deriveClicksToLpv(totals.landingViews, totals.clicks);
    totals.campaignCount = ids.size;

    return totals;
}

/**
 * Rolls up already-aggregated campaigns into account totals (for a table's
 * pinned summary row). Additive fields summed; ratios re-derived from the sums,
 * so the summary reconciles with {@link computeTotals}.
 */
export function sumAggregates(aggregates: CampaignAggregate[]): AccountTotals {
    const totals: AccountTotals = {
        spend: 0,
        revenue: 0,
        purchases: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        landingViews: 0,
        addToCart: 0,
        checkoutInitiated: 0,
        roas: 0,
        ctr: 0,
        cpc: 0,
        cpm: 0,
        costPerPurchase: 0,
        clicksToLpv: 0,
        campaignCount: aggregates.length,
    };

    for (const a of aggregates) {
        totals.spend += a.spend;
        totals.revenue += a.revenue;
        totals.purchases += a.purchases;
        totals.impressions += a.impressions;
        totals.clicks += a.clicks;
        totals.reach += a.reach;
        totals.landingViews += a.landingViews;
        totals.addToCart += a.addToCart;
        totals.checkoutInitiated += a.checkoutInitiated;
    }

    totals.roas = deriveRoas(totals.revenue, totals.spend);
    totals.ctr = deriveCtr(totals.clicks, totals.impressions);
    totals.cpc = deriveCpc(totals.spend, totals.clicks);
    totals.cpm = deriveCpm(totals.spend, totals.impressions);
    totals.costPerPurchase = deriveCostPerPurchase(totals.spend, totals.purchases);
    totals.clicksToLpv = deriveClicksToLpv(totals.landingViews, totals.clicks);

    return totals;
}

/* ────────────────────────────────────────────────────────────────────────
 * Weekly creative-type breakdown
 *
 * Operates on AD-WEEK rows (`level=ad`, `time_increment=7` — one row per ad
 * per 7-day bucket, buckets aligned to the query's `since`). Each ad is
 * classified Inhouse/Parent by the caller-supplied classifier (see
 * @/lib/creativeTypes), additive metrics are summed per (week × class), and
 * ratios are derived from those sums — the same SUM-then-DERIVE rule as
 * everything else in this file. The Total bucket is summed independently from
 * ALL rows, so it stays correct even if the classifier changes.
 * ──────────────────────────────────────────────────────────────────────── */

/** Summed + derived metrics for one creative class within one week. */
export interface CreativeBucket {
    spend: number;
    revenue: number;
    purchases: number;
    impressions: number;
    clicks: number;
    landingViews: number;
    addToCart: number;
    checkoutInitiated: number;

    roas: number;
    ctr: number;
    clicksToLpv: number;
}

export interface WeekBreakdown {
    /** Bucket bounds (YYYY-MM-DD, inclusive). */
    since: string;
    until: string;
    /** Display label, e.g. "10 Jun – 16 Jun". */
    label: string;
    inhouse: CreativeBucket;
    parent: CreativeBucket;
    total: CreativeBucket;
}

function emptyBucket(): CreativeBucket {
    return {
        spend: 0,
        revenue: 0,
        purchases: 0,
        impressions: 0,
        clicks: 0,
        landingViews: 0,
        addToCart: 0,
        checkoutInitiated: 0,
        roas: 0,
        ctr: 0,
        clicksToLpv: 0,
    };
}

function addRowToBucket(bucket: CreativeBucket, row: MetaAdRow): void {
    bucket.spend += toNumber(row.spend);
    bucket.revenue += getRevenue(row);
    bucket.purchases += getPurchases(row);
    bucket.impressions += toNumber(row.impressions);
    bucket.clicks += toNumber(row.clicks);
    bucket.landingViews += pickCanonicalValue(row.actions, LANDING_PAGE_VIEW_PRIORITY);
    bucket.addToCart += pickCanonicalValue(row.actions, ADD_TO_CART_PRIORITY);
    bucket.checkoutInitiated += pickCanonicalValue(
        row.actions,
        INITIATE_CHECKOUT_PRIORITY
    );
}

function deriveBucket(bucket: CreativeBucket): void {
    bucket.roas = deriveRoas(bucket.revenue, bucket.spend);
    bucket.ctr = deriveCtr(bucket.clicks, bucket.impressions);
    bucket.clicksToLpv = deriveClicksToLpv(bucket.landingViews, bucket.clicks);
}

/** Short local date label, e.g. "10 Jun". Parses YMD as a LOCAL date. */
function shortDayMonth(ymd: string): string {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(LOCALE, {
        day: "numeric",
        month: "short",
    });
}

/**
 * Groups ad-week rows into weeks (keyed by the bucket's `date_start`), splits
 * each week by creative class, and derives ratios. Weeks are returned in
 * chronological order.
 */
export function aggregateWeeklyByCreative(
    rows: MetaAdRow[],
    classify: (adName: string | undefined) => "inhouse" | "parent"
): WeekBreakdown[] {
    const byWeek = new Map<string, WeekBreakdown>();

    for (const row of rows) {
        const key = row.date_start;
        let week = byWeek.get(key);

        if (!week) {
            week = {
                since: row.date_start,
                until: row.date_stop,
                label: `${shortDayMonth(row.date_start)} – ${shortDayMonth(row.date_stop)}`,
                inhouse: emptyBucket(),
                parent: emptyBucket(),
                total: emptyBucket(),
            };
            byWeek.set(key, week);
        }

        addRowToBucket(week[classify(row.ad_name)], row);
        addRowToBucket(week.total, row);
    }

    const result = Array.from(byWeek.values());
    for (const week of result) {
        deriveBucket(week.inhouse);
        deriveBucket(week.parent);
        deriveBucket(week.total);
    }

    result.sort((a, b) => a.since.localeCompare(b.since));
    return result;
}

/* ────────────────────────────────────────────────────────────────────────
 * Daily time series (charts)
 * ──────────────────────────────────────────────────────────────────────── */

export interface DailyMetricPoint {
    date: string;
    spend: number;
    revenue: number;
    purchases: number;
    roas: number;
}

/**
 * Sums metrics per calendar day (across all campaigns) and derives daily ROAS,
 * sorted ascending by date. Correct unit for trend charts.
 */
export function getDailySeries(rows: MetaCampaign[]): DailyMetricPoint[] {
    const byDate = new Map<string, DailyMetricPoint>();

    for (const row of rows) {
        const date = row.date_start;
        let point = byDate.get(date);

        if (!point) {
            point = { date, spend: 0, revenue: 0, purchases: 0, roas: 0 };
            byDate.set(date, point);
        }

        point.spend += toNumber(row.spend);
        point.revenue += getRevenue(row);
        point.purchases += getPurchases(row);
    }

    const result = Array.from(byDate.values());
    for (const point of result) {
        point.roas = deriveRoas(point.revenue, point.spend);
    }

    result.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    return result;
}

/* ────────────────────────────────────────────────────────────────────────
 * Formatting (single definition, INR / en-IN)
 * ──────────────────────────────────────────────────────────────────────── */

const LOCALE = "en-IN";

/** ₹ with thousands separators. Defaults to 2 fraction digits. */
export function formatCurrency(value: number, fractionDigits = 2): string {
    return `₹${toNumber(value).toLocaleString(LOCALE, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    })}`;
}

/** Compact ₹ in Indian notation, e.g. ₹2.76L, ₹1.2Cr (week-wise summaries). */
export function formatCompactINR(value: number): string {
    return `₹${toNumber(value).toLocaleString(LOCALE, {
        notation: "compact",
        maximumFractionDigits: 2,
    })}`;
}

/** Whole-number formatting with thousands separators (counts). */
export function formatNumber(value: number, fractionDigits = 0): string {
    return toNumber(value).toLocaleString(LOCALE, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    });
}

/** Percentage, e.g. 1.23% (value is already a percentage, not a fraction). */
export function formatPercent(value: number, fractionDigits = 2): string {
    return `${toNumber(value).toFixed(fractionDigits)}%`;
}

/** ROAS ratio, e.g. 3.42 (dimensionless multiple). */
export function formatRoas(value: number, fractionDigits = 2): string {
    return toNumber(value).toFixed(fractionDigits);
}

/* ────────────────────────────────────────────────────────────────────────
 * Focus areas — actionable budget recommendations
 *
 * Distinct from the Top/Worst ROAS rankings (which just sort): this compares
 * each campaign against the ACCOUNT'S weighted ROAS and its median spend to
 * surface two specific actions:
 *   • Scale Up    — efficient (ROAS well above account average) AND
 *                    under-funded (spend at/below the account median): the
 *                    budget has room to grow before efficiency degrades.
 *   • Reallocate  — spend at/above the median AND ROAS well below the account
 *                    average: real money going to a laggard, worth trimming.
 * Thresholds (15%) avoid flagging campaigns that are only marginally off the
 * average, which would just be noise.
 * ──────────────────────────────────────────────────────────────────────── */

export interface FocusAreas {
    scaleUp: CampaignAggregate[];
    reallocate: CampaignAggregate[];
    accountRoas: number;
    medianSpend: number;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

export function getFocusAreas(
    campaigns: CampaignAggregate[],
    count = 3
): FocusAreas {
    const spending = campaigns.filter((c) => c.spend > 0);
    if (spending.length === 0) {
        return { scaleUp: [], reallocate: [], accountRoas: 0, medianSpend: 0 };
    }

    const totalSpend = spending.reduce((s, c) => s + c.spend, 0);
    const totalRevenue = spending.reduce((s, c) => s + c.revenue, 0);
    const accountRoas = deriveRoas(totalRevenue, totalSpend);
    const medianSpend = median(spending.map((c) => c.spend));

    const scaleUp = spending
        .filter((c) => c.roas >= accountRoas * 1.15 && c.spend <= medianSpend)
        .sort((a, b) => b.roas - a.roas)
        .slice(0, count);

    const reallocate = spending
        .filter((c) => c.spend >= medianSpend && c.roas <= accountRoas * 0.85)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, count);

    return { scaleUp, reallocate, accountRoas, medianSpend };
}

/* ────────────────────────────────────────────────────────────────────────
 * Conversion funnel
 *
 * Built entirely from fields we already fetch (`impressions`, `clicks`, and
 * the full `actions` array) — no new Meta API fields or calls required.
 * Each mid-funnel stage picks ONE canonical action type by priority, same
 * pattern as purchases, so overlapping event types are never double-counted.
 * ──────────────────────────────────────────────────────────────────────── */

export interface FunnelStage {
    key: "impressions" | "clicks" | "landingViews" | "addToCart" | "checkout" | "purchases";
    label: string;
    value: number;
    /** % of this stage vs the immediately preceding one (null for the first stage). */
    pctOfPrevious: number | null;
    /** % of this stage vs the very first stage (impressions). */
    pctOfFirst: number;
}

/**
 * Account-wide conversion funnel: Impressions → Clicks → Landing Page Views →
 * Add to Cart → Checkout Initiated → Purchases. Sums additive counts across
 * rows, then derives stage-over-stage conversion rates — same SUM-then-DERIVE
 * rule as every other metric in this file.
 */
export function computeFunnel(rows: MetaCampaign[]): FunnelStage[] {
    let impressions = 0;
    let clicks = 0;
    let landingViews = 0;
    let addToCart = 0;
    let checkout = 0;
    let purchases = 0;

    for (const row of rows) {
        impressions += toNumber(row.impressions);
        clicks += toNumber(row.clicks);
        landingViews += pickCanonicalValue(row.actions, LANDING_PAGE_VIEW_PRIORITY);
        addToCart += pickCanonicalValue(row.actions, ADD_TO_CART_PRIORITY);
        checkout += pickCanonicalValue(row.actions, INITIATE_CHECKOUT_PRIORITY);
        purchases += getPurchases(row);
    }

    const raw: { key: FunnelStage["key"]; label: string; value: number }[] = [
        { key: "impressions", label: "Impressions", value: impressions },
        { key: "clicks", label: "Clicks", value: clicks },
        { key: "landingViews", label: "Landing Page Views", value: landingViews },
        { key: "addToCart", label: "Add to Cart", value: addToCart },
        { key: "checkout", label: "Checkout Initiated", value: checkout },
        { key: "purchases", label: "Purchases", value: purchases },
    ];

    const first = raw[0].value;
    return raw.map((stage, i) => ({
        ...stage,
        pctOfPrevious: i === 0 ? null : safeDivide(stage.value, raw[i - 1].value) * 100,
        pctOfFirst: safeDivide(stage.value, first) * 100,
    }));
}
