"use client";

/**
 * Creative Insights — which individual ADS are working (not campaigns, not ad
 * sets). Defaults to live ads only; a toggle adds ads that spent in the range
 * but are no longer live.
 *
 * Owns its fetch (`/api/meta/ads`), loaded lazily when the section nears the
 * viewport, and follows the header's date range. Verdict rules live in
 * `@/lib/adVerdict` (hand-editable).
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ExternalLink,
    Eye,
} from "lucide-react";

import StaleNotice, { staleSince } from "@/components/StaleNotice";
import {
    FATIGUE_FREQUENCY,
    FUNNEL_LEAK_FRACTION,
    SCALE_MIN_PURCHASES,
    SCALE_ROAS_MARGIN,
    VIDEO_MIN_IMPRESSIONS,
    VIDEO_STRONG_FRACTION,
    VIDEO_WEAK_FRACTION,
    Verdict,
    VERDICT_LABEL,
    getVerdict,
    isScaleCandidate,
    roasBar,
    scaleSpendCutoff,
} from "@/lib/adVerdict";
import {
    FunnelStage,
    computeFunnel,
    deriveCostPerPurchase,
    deriveHoldRate,
    deriveHookRate,
    deriveCtr,
    deriveRoas,
    formatCurrency,
    formatNumber,
    formatPercent,
    formatRoas,
    getAvgWatchSeconds,
    getPurchases,
    getRevenue,
    getThruPlays,
    getVideoViews3s,
    safeDivide,
    toNumber,
} from "@/lib/metrics";
import { useNearViewport } from "@/lib/useNearViewport";
import { AdFormat, CreativeInsightsData, MetaLiveAd } from "@/types/meta";

interface Props {
    datePreset: string;
    customSince: string;
    customUntil: string;
}

interface AdRowView {
    ad: MetaLiveAd;
    spend: number;
    ctr: number;
    frequency: number;
    purchases: number;
    /** Purchases / clicks, as a percentage. */
    cvr: number;
    cpa: number;
    /** Average order value: revenue / purchases. */
    aov: number;
    roas: number;
    verdict: Verdict;
    /** Winning, modestly funded, not tired: the obvious ad to give more budget. */
    scale: boolean;
    funnel: FunnelStage[];
    /** Video metrics; only meaningful when `video` is true. */
    video: boolean;
    /** Enough video delivery to judge the hook. */
    videoJudgeable: boolean;
    views3s: number;
    thruPlays: number;
    hook: number;
    hold: number;
    avgWatch: number;
}

/** Average hook/hold across the video ads in view: the yardstick for "weak". */
interface VideoBench {
    hook: number;
    hold: number;
    count: number;
}

type VideoTone = "weak" | "ok" | "strong";

/** Rates are judged against the video-ads average (see adVerdict.ts). */
function videoTone(rate: number, avg: number): VideoTone {
    if (avg <= 0) return "ok";
    if (rate < avg * VIDEO_WEAK_FRACTION) return "weak";
    if (rate >= avg * VIDEO_STRONG_FRACTION) return "strong";
    return "ok";
}

const TONE_COLOR: Record<VideoTone, string | undefined> = {
    weak: "var(--negative)",
    ok: undefined,
    strong: "var(--positive)",
};

type SortKey =
    | "name"
    | "spend"
    | "ctr"
    | "hook"
    | "hold"
    | "frequency"
    | "purchases"
    | "cvr"
    | "cpa"
    | "aov"
    | "roas";

const FORMAT_LABEL: Record<AdFormat, string> = {
    video: "Video",
    carousel: "Carousel",
    static: "Static",
    unknown: "—",
};

const STATUS_LABEL: Record<string, string> = {
    ACTIVE: "Live",
    PAUSED: "Paused",
    CAMPAIGN_PAUSED: "Campaign paused",
    ADSET_PAUSED: "Ad set paused",
    WITH_ISSUES: "With issues",
    DISAPPROVED: "Disapproved",
    PENDING_REVIEW: "In review",
    ARCHIVED: "Archived",
};

const VERDICT_STYLE: Record<Verdict, { color: string; bg: string }> = {
    working: { color: "var(--positive)", bg: "var(--positive-soft)" },
    watch: { color: "var(--warning)", bg: "var(--warning-soft)" },
    "not-working": { color: "var(--negative)", bg: "var(--negative-soft)" },
    "too-early": { color: "var(--ink-muted)", bg: "var(--surface-2)" },
    "no-delivery": { color: "var(--ink-muted)", bg: "var(--surface-2)" },
};

const VERDICT_ORDER: Verdict[] = [
    "not-working",
    "watch",
    "working",
    "too-early",
    "no-delivery",
];

const PAGE_SIZE = 15;

/** Links come from Meta's API; only ever render https ones. */
function safeUrl(url: string | undefined): string | undefined {
    return url && url.startsWith("https://") ? url : undefined;
}

export default function CreativeInsights({
    datePreset,
    customSince,
    customUntil,
}: Props) {
    const [rootRef, near] = useNearViewport<HTMLDivElement>();
    const [liveOnly, setLiveOnly] = useState(true);
    const [data, setData] = useState<CreativeInsightsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stale, setStale] = useState<number | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    const [verdictFilter, setVerdictFilter] = useState<Verdict | null>(null);
    const [fatigueOnly, setFatigueOnly] = useState(false);
    const [weakHookOnly, setWeakHookOnly] = useState(false);
    const [scaleOnly, setScaleOnly] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
        key: "spend",
        desc: true,
    });
    const [shown, setShown] = useState(PAGE_SIZE);

    const customIncomplete =
        datePreset === "custom" && (!customSince || !customUntil);

    useEffect(() => {
        if (!near) return; // lazy: wait until the section is about to be seen
        if (customIncomplete) return; // the body shows a "pick dates" prompt
        let ignore = false;

        async function load() {
            setLoading(true);
            const range =
                datePreset === "custom"
                    ? `since=${customSince}&until=${customUntil}`
                    : `datePreset=${datePreset}`;
            try {
                const res = await fetch(
                    `/api/meta/ads?${range}&scope=${liveOnly ? "live" : "all"}`
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
    }, [
        near,
        datePreset,
        customSince,
        customUntil,
        customIncomplete,
        liveOnly,
        reloadKey,
    ]);

    // Per-ad metrics + verdicts. The benchmark is the blended ROAS of the ads in
    // view, so "working" means "at least as good as your live ads overall".
    const { rows, benchmark, benchFunnel, videoBench } = useMemo(() => {
        const ads = data?.ads ?? [];
        const base = ads.map((ad) => {
            const spend = toNumber(ad.spend);
            const revenue = getRevenue(ad);
            return {
                ad,
                spend,
                revenue,
                ctr: deriveCtr(toNumber(ad.clicks), toNumber(ad.impressions)),
                purchases: getPurchases(ad),
                clicks: toNumber(ad.clicks),
                impressions: toNumber(ad.impressions),
                views3s: getVideoViews3s(ad),
                thruPlays: getThruPlays(ad),
            };
        });
        const totalSpend = base.reduce((t, r) => t + r.spend, 0);
        const totalRevenue = base.reduce((t, r) => t + r.revenue, 0);
        const benchmark = deriveRoas(totalRevenue, totalSpend);
        const scaleCutoff = scaleSpendCutoff(base.map((r) => r.spend));

        const rows: AdRowView[] = base.map((r) => {
            const roas = deriveRoas(r.revenue, r.spend);
            return {
                ad: r.ad,
                spend: r.spend,
                ctr: r.ctr,
                frequency: toNumber(r.ad.frequency),
                purchases: r.purchases,
                cvr: safeDivide(r.purchases, r.clicks) * 100,
                cpa: deriveCostPerPurchase(r.spend, r.purchases),
                aov: safeDivide(r.revenue, r.purchases),
                roas,
                verdict: getVerdict(
                    { spend: r.spend, purchases: r.purchases, roas },
                    benchmark
                ),
                scale: isScaleCandidate(
                    {
                        live: r.ad.status === "ACTIVE",
                        spend: r.spend,
                        purchases: r.purchases,
                        roas,
                        frequency: toNumber(r.ad.frequency),
                    },
                    benchmark,
                    scaleCutoff
                ),
                funnel: computeFunnel([r.ad]),
                video: r.ad.format === "video",
                videoJudgeable:
                    r.ad.format === "video" &&
                    r.impressions >= VIDEO_MIN_IMPRESSIONS &&
                    r.views3s > 0,
                views3s: r.views3s,
                thruPlays: r.thruPlays,
                hook: deriveHookRate(r.views3s, r.impressions),
                hold: deriveHoldRate(r.thruPlays, r.views3s),
                avgWatch: getAvgWatchSeconds(r.ad),
            };
        });

        // Blended hook/hold of the judgeable video ads (sum, then derive).
        const vids = rows.filter((r) => r.videoJudgeable);
        const vImpr = vids.reduce((t, r) => t + toNumber(r.ad.impressions), 0);
        const v3 = vids.reduce((t, r) => t + r.views3s, 0);
        const vThru = vids.reduce((t, r) => t + r.thruPlays, 0);
        const videoBench: VideoBench = {
            hook: deriveHookRate(v3, vImpr),
            hold: deriveHoldRate(vThru, v3),
            count: vids.length,
        };

        // Average funnel across the ads in view: the yardstick for "leaks".
        return { rows, benchmark, benchFunnel: computeFunnel(ads), videoBench };
    }, [data]);

    const counts = useMemo(() => {
        const c: Record<Verdict, number> = {
            working: 0,
            watch: 0,
            "not-working": 0,
            "too-early": 0,
            "no-delivery": 0,
        };
        for (const r of rows) c[r.verdict]++;
        return c;
    }, [rows]);

    const totalShownSpend = useMemo(
        () => rows.reduce((t, r) => t + r.spend, 0),
        [rows]
    );

    const tiredCount = useMemo(
        () =>
            rows.filter((r) => r.spend > 0 && r.frequency >= FATIGUE_FREQUENCY)
                .length,
        [rows]
    );

    const scaleCount = useMemo(() => rows.filter((r) => r.scale).length, [rows]);

    const weakHookCount = useMemo(
        () =>
            rows.filter(
                (r) =>
                    r.videoJudgeable &&
                    videoTone(r.hook, videoBench.hook) === "weak"
            ).length,
        [rows, videoBench]
    );

    const visible = useMemo(() => {
        let filtered = verdictFilter
            ? rows.filter((r) => r.verdict === verdictFilter)
            : rows;
        if (fatigueOnly) {
            filtered = filtered.filter(
                (r) => r.spend > 0 && r.frequency >= FATIGUE_FREQUENCY
            );
        }
        if (scaleOnly) filtered = filtered.filter((r) => r.scale);
        if (weakHookOnly) {
            filtered = filtered.filter(
                (r) =>
                    r.videoJudgeable &&
                    videoTone(r.hook, videoBench.hook) === "weak"
            );
        }
        const dir = sort.desc ? -1 : 1;
        return [...filtered].sort((a, b) => {
            if (sort.key === "name") {
                return dir * a.ad.ad_name.localeCompare(b.ad.ad_name);
            }
            return dir * (a[sort.key] - b[sort.key]);
        });
    }, [rows, verdictFilter, fatigueOnly, weakHookOnly, scaleOnly, videoBench, sort]);

    function toggleSort(key: SortKey) {
        setSort((s) =>
            s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }
        );
    }

    const header = (
        label: string,
        key: SortKey,
        align: "left" | "right" = "right"
    ) => (
        <th
            className={`whitespace-nowrap border-b border-hairline px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted ${
                align === "right" ? "text-right" : "text-left"
            }`}
        >
            <button
                type="button"
                onClick={() => toggleSort(key)}
                className="inline-flex items-center gap-1 uppercase transition-colors hover:text-ink"
            >
                {label}
                {sort.key === key &&
                    (sort.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
            </button>
        </th>
    );

    return (
        <div ref={rootRef} className="space-y-4">
            {!customIncomplete && !loading && !error && (
                <StaleNotice
                    since={stale}
                    onRetry={() => setReloadKey((k) => k + 1)}
                />
            )}

            <div className="rounded-[var(--radius-card)] border border-hairline bg-surface">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-ink">
                            Creative Insights
                        </h2>
                        <p className="mt-0.5 text-xs text-ink-muted">
                            Performance by {liveOnly ? "live " : ""}ad · working
                            means ROAS ≥ {formatRoas(Math.max(1, benchmark))}×
                            (your {liveOnly ? "live-ads" : "shown-ads"} average)
                        </p>
                    </div>

                    <div className="inline-flex rounded-[10px] border border-hairline p-0.5 text-xs font-medium">
                        {[
                            { label: "Live ads", value: true },
                            { label: "All ads", value: false },
                        ].map((o) => (
                            <button
                                key={o.label}
                                type="button"
                                onClick={() => {
                                    setLiveOnly(o.value);
                                    setVerdictFilter(null);
                                    setFatigueOnly(false);
                                    setWeakHookOnly(false);
                                    setScaleOnly(false);
                                    setExpandedId(null);
                                    setShown(PAGE_SIZE);
                                }}
                                className={`rounded-[8px] px-3 py-1.5 transition-colors ${
                                    liveOnly === o.value
                                        ? "bg-surface-2 text-ink"
                                        : "text-ink-muted hover:text-ink"
                                }`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Verdict summary — click a chip to filter */}
                {!loading && !error && rows.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3">
                        {VERDICT_ORDER.filter((v) => counts[v] > 0).map((v) => {
                            const active = verdictFilter === v;
                            const style = VERDICT_STYLE[v];
                            return (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => {
                                        setVerdictFilter(active ? null : v);
                                        setShown(PAGE_SIZE);
                                    }}
                                    className="rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90"
                                    style={{
                                        color: style.color,
                                        background: style.bg,
                                        outline: active
                                            ? `1.5px solid ${style.color}`
                                            : "none",
                                    }}
                                >
                                    {counts[v]} {VERDICT_LABEL[v].toLowerCase()}
                                </button>
                            );
                        })}
                        {scaleCount > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setScaleOnly((f) => !f);
                                    setShown(PAGE_SIZE);
                                }}
                                title={`Live ads with ${SCALE_MIN_PURCHASES}+ purchases and ROAS at least ${Math.round((SCALE_ROAS_MARGIN - 1) * 100)}% above the working bar, not tired, and still modestly funded: the best places to add budget`}
                                className="rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90"
                                style={{
                                    color: "var(--positive)",
                                    background: "var(--positive-soft)",
                                    outline: scaleOnly
                                        ? "1.5px solid var(--positive)"
                                        : "none",
                                }}
                            >
                                {"\u2197"} {scaleCount} scale candidate{scaleCount === 1 ? "" : "s"}
                            </button>
                        )}
                        {tiredCount > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setFatigueOnly((f) => !f);
                                    setShown(PAGE_SIZE);
                                }}
                                title={`Average frequency of ${FATIGUE_FREQUENCY}+: the same people have seen these ads several times`}
                                className="rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90"
                                style={{
                                    color: "var(--warning)",
                                    background: "var(--warning-soft)",
                                    outline: fatigueOnly
                                        ? "1.5px solid var(--warning)"
                                        : "none",
                                }}
                            >
                                {tiredCount} tired (freq ≥ {FATIGUE_FREQUENCY})
                            </button>
                        )}
                        {weakHookCount > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setWeakHookOnly((f) => !f);
                                    setShown(PAGE_SIZE);
                                }}
                                title={`Video ads whose hook rate is below ${Math.round(VIDEO_WEAK_FRACTION * 100)}% of your video average (${formatPercent(videoBench.hook, 1)}): the first 3 seconds aren't stopping people`}
                                className="rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90"
                                style={{
                                    color: "var(--negative)",
                                    background: "var(--negative-soft)",
                                    outline: weakHookOnly
                                        ? "1.5px solid var(--negative)"
                                        : "none",
                                }}
                            >
                                {weakHookCount} weak hook
                            </button>
                        )}
                        {(verdictFilter || fatigueOnly || weakHookOnly || scaleOnly) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setVerdictFilter(null);
                                    setFatigueOnly(false);
                                    setWeakHookOnly(false);
                                    setScaleOnly(false);
                                }}
                                className="text-xs text-ink-muted underline hover:text-ink"
                            >
                                Clear filter
                            </button>
                        )}
                    </div>
                )}

                {/* Body */}
                {customIncomplete ? (
                    <p className="p-8 text-center text-sm text-ink-muted">
                        Pick a start and end date above to see ad performance.
                    </p>
                ) : loading ? (
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
                ) : visible.length === 0 ? (
                    <p className="p-8 text-center text-sm text-ink-muted">
                        {liveOnly
                            ? "No live ads found."
                            : "No ads with delivery in this range."}
                    </p>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-sm">
                                <thead>
                                    <tr>
                                        {header("Ad / Creative", "name", "left")}
                                        <th className="whitespace-nowrap border-b border-hairline px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                                            Status
                                        </th>
                                        <th className="whitespace-nowrap border-b border-hairline px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                                            Format
                                        </th>
                                        {header("Spend", "spend")}
                                        {header("CTR", "ctr")}
                                        {header("Hook", "hook")}
                                        {header("Hold", "hold")}
                                        {header("Freq.", "frequency")}
                                        {header("Purch.", "purchases")}
                                        {header("CVR", "cvr")}
                                        {header("CPA", "cpa")}
                                        {header("AOV", "aov")}
                                        {header("ROAS", "roas")}
                                        <th className="whitespace-nowrap border-b border-hairline px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                                            Verdict
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.slice(0, shown).map((r) => {
                                        const vs = VERDICT_STYLE[r.verdict];
                                        const live = r.ad.status === "ACTIVE";
                                        const open = expandedId === r.ad.ad_id;
                                        const tired =
                                            r.spend > 0 &&
                                            r.frequency >= FATIGUE_FREQUENCY;
                                        const cell =
                                            "whitespace-nowrap border-b border-hairline px-4 py-3";
                                        const num = `${cell} text-right tabular-nums text-ink-secondary`;
                                        return (
                                            <Fragment key={r.ad.ad_id}>
                                                <tr
                                                    onClick={() =>
                                                        setExpandedId(
                                                            open ? null : r.ad.ad_id
                                                        )
                                                    }
                                                    className="cursor-pointer transition-colors hover:bg-surface-2"
                                                    aria-expanded={open}
                                                >
                                                    <td className="max-w-[320px] border-b border-hairline px-4 py-3">
                                                        <div className="flex items-start gap-2">
                                                            <ChevronRight
                                                                size={14}
                                                                className={`mt-0.5 shrink-0 text-ink-muted transition-transform ${
                                                                    open ? "rotate-90" : ""
                                                                }`}
                                                            />
                                                            <div className="min-w-0">
                                                                <p
                                                                    className="truncate font-medium text-ink"
                                                                    title={r.ad.ad_name}
                                                                >
                                                                    {r.ad.ad_name}
                                                                </p>
                                                                {r.ad.campaign_name && (
                                                                    <p
                                                                        className="mt-0.5 truncate text-xs text-ink-muted"
                                                                        title={r.ad.campaign_name}
                                                                    >
                                                                        {r.ad.campaign_name}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            {safeUrl(r.ad.previewUrl) && (
                                                                <a
                                                                    href={safeUrl(r.ad.previewUrl)}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    title="Preview this ad"
                                                                    aria-label={`Preview ad: ${r.ad.ad_name}`}
                                                                    className="ml-auto mt-0.5 shrink-0 rounded p-0.5 text-ink-muted transition-colors hover:text-ink"
                                                                >
                                                                    <ExternalLink size={14} />
                                                                </a>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className={cell}>
                                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
                                                            <span
                                                                className="h-2 w-2 rounded-full"
                                                                style={{
                                                                    background: live
                                                                        ? "var(--positive)"
                                                                        : "var(--ink-muted)",
                                                                }}
                                                            />
                                                            {STATUS_LABEL[r.ad.status] ??
                                                                r.ad.status}
                                                        </span>
                                                    </td>
                                                    <td className={`${cell} text-ink-secondary`}>
                                                        {FORMAT_LABEL[r.ad.format]}
                                                    </td>
                                                    <td className={`${cell} text-right tabular-nums text-ink`}>
                                                        {formatCurrency(r.spend, 0)}
                                                    </td>
                                                    <td className={num}>
                                                        {r.spend > 0 ? formatPercent(r.ctr) : "\u2014"}
                                                    </td>
                                                    <td
                                                        className={num}
                                                        style={
                                                            r.videoJudgeable
                                                                ? { color: TONE_COLOR[videoTone(r.hook, videoBench.hook)] }
                                                                : undefined
                                                        }
                                                        title="Hook rate: share of impressions that watched 3+ seconds"
                                                    >
                                                        {r.video && r.views3s > 0
                                                            ? formatPercent(r.hook, 1)
                                                            : "\u2014"}
                                                    </td>
                                                    <td
                                                        className={num}
                                                        style={
                                                            r.videoJudgeable
                                                                ? { color: TONE_COLOR[videoTone(r.hold, videoBench.hold)] }
                                                                : undefined
                                                        }
                                                        title="Hold rate: of those who passed 3 seconds, the share that watched to 15s or the end"
                                                    >
                                                        {r.video && r.views3s > 0
                                                            ? formatPercent(r.hold, 1)
                                                            : "\u2014"}
                                                    </td>
                                                    <td
                                                        className={`${cell} text-right tabular-nums ${
                                                            tired ? "font-semibold" : "text-ink-secondary"
                                                        }`}
                                                        style={tired ? { color: "var(--warning)" } : undefined}
                                                        title={
                                                            tired
                                                                ? "Tired: people have seen this ad several times on average"
                                                                : undefined
                                                        }
                                                    >
                                                        {r.spend > 0 ? r.frequency.toFixed(2) : "\u2014"}
                                                    </td>
                                                    <td className={num}>
                                                        {formatNumber(r.purchases)}
                                                    </td>
                                                    <td className={num}>
                                                        {r.spend > 0 ? formatPercent(r.cvr) : "\u2014"}
                                                    </td>
                                                    <td className={num}>
                                                        {r.purchases > 0
                                                            ? formatCurrency(r.cpa, 0)
                                                            : "\u2014"}
                                                    </td>
                                                    <td className={num}>
                                                        {r.purchases > 0
                                                            ? formatCurrency(r.aov, 0)
                                                            : "\u2014"}
                                                    </td>
                                                    <td
                                                        className={`${cell} text-right font-semibold tabular-nums`}
                                                        style={{ color: vs.color }}
                                                    >
                                                        {r.spend > 0
                                                            ? `${formatRoas(r.roas)}\u00d7`
                                                            : "\u2014"}
                                                    </td>
                                                    <td className={cell}>
                                                        <span
                                                            className="rounded-full px-2.5 py-1 text-xs font-medium"
                                                            style={{
                                                                color: vs.color,
                                                                background: vs.bg,
                                                            }}
                                                        >
                                                            {VERDICT_LABEL[r.verdict]}
                                                        </span>
                                                        {r.scale && (
                                                            <span
                                                                className="ml-1.5 rounded-full px-2 py-1 text-xs font-medium"
                                                                style={{
                                                                    color: "var(--positive)",
                                                                    background: "var(--positive-soft)",
                                                                }}
                                                                title="Scale candidate: winning and modestly funded"
                                                            >
                                                                {"\u2197"} Scale
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                                {open && (
                                                    <tr>
                                                        <td
                                                            colSpan={14}
                                                            className="border-b border-hairline bg-surface-2/40 px-5 py-4"
                                                        >
                                                            <div className="space-y-4">
                                                                <AdLinks ad={r.ad} />
                                                                {r.scale && (
                                                                    <ScaleNote
                                                                        row={r}
                                                                        bar={roasBar(benchmark)}
                                                                        totalSpend={totalShownSpend}
                                                                    />
                                                                )}
                                                                {r.video && (
                                                                    <VideoDetail
                                                                        row={r}
                                                                        bench={videoBench}
                                                                    />
                                                                )}
                                                                <FunnelDetail
                                                                    row={r}
                                                                    bench={benchFunnel}
                                                                />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between gap-3 px-5 py-3 text-xs text-ink-muted">
                            <span>
                                Showing {Math.min(shown, visible.length)} of{" "}
                                {visible.length} ads
                            </span>
                            {visible.length > shown && (
                                <button
                                    type="button"
                                    onClick={() => setShown((n) => n + PAGE_SIZE)}
                                    className="rounded-[10px] border border-hairline px-3 py-1.5 font-medium text-ink transition-colors hover:border-hairline-strong"
                                >
                                    Show more
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * One ad's own funnel (impressions -> clicks -> landing page -> add to cart ->
 * checkout -> purchase) with each step's conversion compared against the
 * average of the ads in view. A step converting well below that average is a
 * "leak": that is where this ad loses people.
 */
function FunnelDetail({
    row,
    bench,
}: {
    row: AdRowView;
    bench: FunnelStage[];
}) {
    const MIN_SAMPLE = 30; // ignore steps fed by too few people to judge

    const steps = row.funnel.map((stage, i) => {
        const prev = i > 0 ? row.funnel[i - 1] : null;
        const benchRate = i > 0 ? bench[i].pctOfPrevious : null;
        const rate = stage.pctOfPrevious;
        const ratio =
            rate !== null && benchRate ? rate / benchRate : null;
        const leak =
            prev !== null &&
            prev.value >= MIN_SAMPLE &&
            ratio !== null &&
            ratio < FUNNEL_LEAK_FRACTION;
        return { stage, rate, benchRate, ratio, leak };
    });

    const worst = steps
        .filter((s) => s.leak)
        .sort((a, b) => (a.ratio ?? 1) - (b.ratio ?? 1))[0];

    return (
        <div className="space-y-3">
            <p className="text-xs text-ink-secondary">
                {row.spend <= 0
                    ? "This ad had no delivery in the selected range."
                    : worst
                      ? `Biggest leak: ${worst.stage.label} \u2014 only ${formatPercent(worst.rate ?? 0)} of the previous step, vs ${formatPercent(worst.benchRate ?? 0)} on average.`
                      : "No step is converting well below your average \u2014 this ad's funnel looks healthy."}
            </p>
            <div className="flex flex-wrap items-stretch gap-2">
                {steps.map(({ stage, rate, benchRate, leak }, i) => (
                    <div key={stage.key} className="flex items-center gap-2">
                        {i > 0 && (
                            <ChevronRight size={14} className="text-ink-muted" />
                        )}
                        <div
                            className="min-w-[112px] rounded-[10px] border px-3 py-2"
                            style={{
                                borderColor: leak
                                    ? "var(--negative)"
                                    : "var(--hairline)",
                                background: leak
                                    ? "var(--negative-soft)"
                                    : "var(--surface)",
                            }}
                        >
                            <p className="text-[11px] uppercase tracking-wider text-ink-muted">
                                {stage.label}
                            </p>
                            <p className="tnum mt-0.5 text-sm font-semibold text-ink">
                                {formatNumber(stage.value)}
                            </p>
                            {rate !== null && (
                                <p
                                    className="tnum mt-0.5 text-[11px]"
                                    style={{
                                        color: leak
                                            ? "var(--negative)"
                                            : "var(--ink-muted)",
                                    }}
                                >
                                    {formatPercent(rate)} of prev
                                    {benchRate !== null &&
                                        ` (avg ${formatPercent(benchRate)})`}
                                </p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Video diagnosis for one ad: hook (did the first 3 seconds stop the scroll?)
 * and hold (did people stay?) against the average of your video ads, with a
 * plain-language read on what to fix.
 */
function VideoDetail({
    row,
    bench,
}: {
    row: AdRowView;
    bench: VideoBench;
}) {
    if (!row.videoJudgeable) {
        return (
            <p className="text-xs text-ink-secondary">
                Not enough video delivery yet to judge the hook (needs at least{" "}
                {formatNumber(VIDEO_MIN_IMPRESSIONS)} impressions with video plays).
            </p>
        );
    }

    const hookTone = videoTone(row.hook, bench.hook);
    const holdTone = videoTone(row.hold, bench.hold);

    const read =
        hookTone === "weak"
            ? "Weak hook: the first 3 seconds aren't stopping people. Try a stronger opening frame or line; the rest of the video barely matters until this improves."
            : holdTone === "weak"
              ? "Good start, weak hold: people begin watching but drop off before 15 seconds. Tighten the middle or move the key message earlier."
              : hookTone === "strong" && holdTone === "strong"
                ? "Strong hook and strong hold: this video keeps attention well. If it isn't selling, look at the offer, landing page or audience instead."
                : hookTone === "strong"
                  ? "Strong hook: it stops the scroll. Watch the hold rate to make sure people stay."
                  : "Hook and hold are in line with your other video ads.";

    const stats: { label: string; value: string; avg?: string; tone: VideoTone }[] = [
        {
            label: "Hook rate",
            value: formatPercent(row.hook, 1),
            avg: `avg ${formatPercent(bench.hook, 1)}`,
            tone: hookTone,
        },
        {
            label: "Hold rate",
            value: formatPercent(row.hold, 1),
            avg: `avg ${formatPercent(bench.hold, 1)}`,
            tone: holdTone,
        },
        {
            label: "Avg watch time",
            value: row.avgWatch > 0 ? `${row.avgWatch.toFixed(1)}s` : "\u2014",
            tone: "ok",
        },
    ];

    return (
        <div className="space-y-3">
            <p className="text-xs text-ink-secondary">{read}</p>
            <div className="flex flex-wrap gap-2">
                {stats.map((st) => (
                    <div
                        key={st.label}
                        className="min-w-[128px] rounded-[10px] border border-hairline bg-surface px-3 py-2"
                    >
                        <p className="text-[11px] uppercase tracking-wider text-ink-muted">
                            {st.label}
                        </p>
                        <p
                            className="tnum mt-0.5 text-sm font-semibold text-ink"
                            style={{ color: TONE_COLOR[st.tone] }}
                        >
                            {st.value}
                        </p>
                        {st.avg && (
                            <p className="tnum mt-0.5 text-[11px] text-ink-muted">
                                {st.avg}
                            </p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Why an ad is a scale candidate, in numbers, plus the cautious way to act on
 * it. ROAS usually dips as an ad's budget grows, so the advice is small steps.
 */
function ScaleNote({
    row,
    bar,
    totalSpend,
}: {
    row: AdRowView;
    bar: number;
    totalSpend: number;
}) {
    const share = totalSpend > 0 ? (row.spend / totalSpend) * 100 : 0;
    return (
        <div
            className="rounded-[10px] px-4 py-3 text-xs"
            style={{
                background: "var(--positive-soft)",
                color: "var(--ink-secondary)",
            }}
        >
            <p>
                <strong style={{ color: "var(--positive)" }}>
                    {"\u2197"} Scale candidate.
                </strong>{" "}
                ROAS {formatRoas(row.roas)}{"\u00d7"} (working bar {formatRoas(bar)}{"\u00d7"}) on{" "}
                {formatNumber(row.purchases)} purchases, yet it has only{" "}
                {formatPercent(share, 1)} of the spend here; frequency{" "}
                {row.frequency.toFixed(2)} leaves room. Raise its budget in small
                steps (around 20% at a time) and re-check ROAS, since returns
                often slip as spend grows.
            </p>
        </div>
    );
}

/** "Preview ad" (how people see it) and "Open in Ads Manager" (to act on it). */
function AdLinks({ ad }: { ad: MetaLiveAd }) {
    const preview = safeUrl(ad.previewUrl);
    const manager = safeUrl(ad.adsManagerUrl);
    if (!preview && !manager) return null;

    const btn =
        "inline-flex items-center gap-1.5 rounded-[10px] border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-hairline-strong";

    return (
        <div className="flex flex-wrap items-center gap-2">
            {preview && (
                <a
                    href={preview}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={btn}
                >
                    <Eye size={14} />
                    Preview ad
                </a>
            )}
            {manager && (
                <a
                    href={manager}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={btn}
                >
                    <ExternalLink size={14} />
                    Open in Ads Manager
                </a>
            )}
        </div>
    );
}
