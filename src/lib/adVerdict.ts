/**
 * adVerdict.ts — "is this ad working?" rules for the Creative Insights table.
 *
 * ✏️  THIS FILE IS MEANT TO BE EDITED BY HAND.
 *
 * Set BREAKEVEN_ROAS to your real break-even (the ROAS at which an ad stops
 * losing money after product cost, shipping, etc.). Everything else keys off
 * these few numbers, so tuning the verdicts never needs other code changes.
 */

/** Below this ROAS an ad is losing money no matter how the account is doing. */
export const BREAKEVEN_ROAS = 1.0;

/** Ads that spent less than this (₹) in the range are "Too early" to judge. */
export const MIN_SPEND_TO_JUDGE = 1500;

/**
 * An ad is "Working" when ROAS ≥ the larger of BREAKEVEN_ROAS and the live-ads
 * benchmark (total revenue ÷ total spend of the ads shown). It is "Watch" when
 * ROAS is at least this fraction of that bar, and "Not working" below it.
 */
export const WATCH_FRACTION = 0.6;

/**
 * Average times each person has seen an ad (over the selected range) at or
 * above which it is flagged as tired. Around 3+ in a few weeks usually means
 * the audience has seen it enough and results start to slide.
 */
export const FATIGUE_FREQUENCY = 3;

/**
 * A funnel step is flagged as a leak when this ad converts it at less than this
 * fraction of your live-ads average for the same step (e.g. 0.7 = 30% worse).
 */
export const FUNNEL_LEAK_FRACTION = 0.7;

/**
 * Video hook/hold rates are judged against the average of the video ads in
 * view (accounts differ a lot, so absolute cut-offs would mislead). A rate below
 * WEAK_FRACTION x that average is flagged weak; at or above STRONG_FRACTION x it
 * is strong.
 */
export const VIDEO_WEAK_FRACTION = 0.7;
export const VIDEO_STRONG_FRACTION = 1.2;

/** Video ads with fewer impressions than this are too thin to judge a hook. */
export const VIDEO_MIN_IMPRESSIONS = 1000;

/**
 * Scale candidates: live ads that are clearly winning yet still get a modest
 * share of spend, so extra budget is the obvious next move. An ad must meet ALL
 * of these:
 *  - at least SCALE_MIN_PURCHASES purchases (enough evidence to trust the ROAS)
 *  - ROAS at least SCALE_ROAS_MARGIN x the "working" bar (scaling usually costs
 *    some ROAS, so it needs headroom, not just a pass)
 *  - frequency below FATIGUE_FREQUENCY (audience not yet tired)
 *  - spend at or below the SCALE_MAX_SPEND_PERCENTILE of judged ads (i.e. not
 *    already one of the big spenders)
 */
export const SCALE_MIN_PURCHASES = 5;
export const SCALE_ROAS_MARGIN = 1.15;
export const SCALE_MAX_SPEND_PERCENTILE = 0.75;

export type Verdict =
    | "working"
    | "watch"
    | "not-working"
    | "too-early"
    | "no-delivery";

export const VERDICT_LABEL: Record<Verdict, string> = {
    working: "Working",
    watch: "Watch",
    "not-working": "Not working",
    "too-early": "Too early",
    "no-delivery": "No delivery",
};

/** The ROAS an ad must reach to count as "Working". */
export function roasBar(benchmarkRoas: number): number {
    return Math.max(BREAKEVEN_ROAS, benchmarkRoas);
}

/**
 * Spend level at or below which an ad still counts as modestly funded: the
 * SCALE_MAX_SPEND_PERCENTILE of the spends of ads that are big enough to judge.
 */
export function scaleSpendCutoff(spends: number[]): number {
    const judged = spends
        .filter((s) => s >= MIN_SPEND_TO_JUDGE)
        .sort((a, b) => a - b);
    if (judged.length === 0) return 0;
    const idx = Math.min(
        judged.length - 1,
        Math.floor(judged.length * SCALE_MAX_SPEND_PERCENTILE)
    );
    return judged[idx];
}

export function isScaleCandidate(
    ad: {
        live: boolean;
        spend: number;
        purchases: number;
        roas: number;
        frequency: number;
    },
    benchmarkRoas: number,
    spendCutoff: number
): boolean {
    return (
        ad.live &&
        ad.spend >= MIN_SPEND_TO_JUDGE &&
        ad.spend <= spendCutoff &&
        ad.purchases >= SCALE_MIN_PURCHASES &&
        ad.roas >= roasBar(benchmarkRoas) * SCALE_ROAS_MARGIN &&
        ad.frequency < FATIGUE_FREQUENCY
    );
}

export function getVerdict(
    ad: { spend: number; purchases: number; roas: number },
    benchmarkRoas: number
): Verdict {
    if (ad.spend <= 0) return "no-delivery";
    if (ad.spend < MIN_SPEND_TO_JUDGE) return "too-early";
    // Spent real money and sold nothing.
    if (ad.purchases === 0) return "not-working";

    const bar = roasBar(benchmarkRoas);
    if (ad.roas >= bar) return "working";
    if (ad.roas >= bar * WATCH_FRACTION) return "watch";
    return "not-working";
}
