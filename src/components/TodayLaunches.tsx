"use client";

/**
 * Today's launches — every ad that went live today, with the time it did, its
 * campaign / ad set and a preview link. Independent of the header's date range
 * (always "today" in the ad account's time zone). Owns its fetch
 * (`/api/meta/launches`) and refreshes itself every few minutes while open.
 */

import { useEffect, useState } from "react";
import { ExternalLink, Rocket } from "lucide-react";

import ChartCard from "@/components/charts/ChartCard";
import StaleNotice, { staleSince } from "@/components/StaleNotice";
import { LaunchedAd, LaunchesData } from "@/types/meta";

const REFRESH_EVERY_MS = 5 * 60 * 1000;

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
    ACTIVE: { label: "Live", color: "var(--positive)", bg: "var(--positive-soft)" },
    PENDING_REVIEW: { label: "In review", color: "var(--warning)", bg: "var(--warning-soft)" },
    IN_PROCESS: { label: "Processing", color: "var(--warning)", bg: "var(--warning-soft)" },
    WITH_ISSUES: { label: "With issues", color: "var(--negative)", bg: "var(--negative-soft)" },
    DISAPPROVED: { label: "Rejected", color: "var(--negative)", bg: "var(--negative-soft)" },
};

function statusStyle(status: string) {
    return (
        STATUS_STYLE[status] ?? {
            // PAUSED, ADSET_PAUSED, … → "Adset paused"
            label: status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " "),
            color: "var(--ink-muted)",
            bg: "var(--surface-2)",
        }
    );
}

/** Links come from Meta's API; only ever render https ones. */
function safeUrl(url: string | undefined): string | undefined {
    return url && url.startsWith("https://") ? url : undefined;
}

/** "6:21 pm" in the account's time zone. */
function timeIn(iso: string, timeZone: string): string {
    return new Date(iso)
        .toLocaleTimeString("en-IN", {
            timeZone,
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase();
}

/** "" for today, else "yesterday " / "10 Oct " (account time zone). */
function dayPrefix(iso: string, timeZone: string, today: string): string {
    const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
    const day = ymd(new Date(iso));
    if (day === today) return "";
    const [y, m, d] = today.split("-").map(Number);
    const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    if (day === yesterday) return "yesterday ";
    return `${new Date(iso).toLocaleDateString("en-IN", { timeZone, day: "numeric", month: "short" })} `;
}

interface Props {
    /** Bump to reload (wired to the header's Refresh button). */
    refreshKey: number;
}

export default function TodayLaunches({ refreshKey }: Props) {
    const [data, setData] = useState<LaunchesData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stale, setStale] = useState<number | null>(null);
    const [tick, setTick] = useState(0);

    // Re-poll while the page is open: launches happen through the day.
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), REFRESH_EVERY_MS);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        let ignore = false;

        async function load() {
            try {
                const res = await fetch("/api/meta/launches");
                const json = await res.json();
                if (ignore) return;

                if (Array.isArray(json?.ads)) {
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

    if (loading) {
        return (
            <div className="h-[180px] animate-pulse rounded-[var(--radius-card)] border border-hairline bg-surface" />
        );
    }
    if (!data) {
        return (
            <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5 text-sm text-ink-secondary">
                Couldn&apos;t load today&apos;s launches{error ? `: ${error}` : "."}
            </div>
        );
    }

    const liveCount = data.ads.filter((a) => a.liveAt).length;
    const th =
        "whitespace-nowrap border-b border-hairline px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted";

    return (
        <div className="space-y-4">
            <StaleNotice since={stale} onRetry={() => setTick((n) => n + 1)} />

            <ChartCard
                title="Launched today"
                subtitle={`Ads that went live today (${data.timezone}), newest first. Time = when Meta approved the ad, or when it was switched back on.`}
                action={
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-secondary">
                        <Rocket size={14} className="text-accent" />
                        {liveCount} live
                    </span>
                }
            >
                {data.ads.length === 0 ? (
                    <p className="py-6 text-center text-sm text-ink-muted">
                        No ads have gone live yet today.
                    </p>
                ) : (
                    <div className="-mx-5 overflow-x-auto">
                        <table className="w-full min-w-[760px] border-collapse text-sm">
                            <thead>
                                <tr>
                                    <th className={th}>Went live</th>
                                    <th className={th}>Ad</th>
                                    <th className={th}>Campaign</th>
                                    <th className={th}>Ad set</th>
                                    <th className={th}>Status</th>
                                    <th className={th}>Links</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.ads.map((ad) => (
                                    <LaunchRow
                                        key={ad.ad_id}
                                        ad={ad}
                                        timezone={data.timezone}
                                        today={data.today}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </ChartCard>
        </div>
    );
}

function LaunchRow({
    ad,
    timezone,
    today,
}: {
    ad: LaunchedAd;
    timezone: string;
    today: string;
}) {
    const s = statusStyle(ad.status);
    const preview = safeUrl(ad.previewUrl);
    const manager = safeUrl(ad.adsManagerUrl);
    const cell = "border-b border-hairline px-4 py-3 align-top";
    const link =
        "inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-ink-secondary transition-colors hover:text-ink";

    return (
        <tr className="transition-colors hover:bg-surface-2">
            <td className={`${cell} whitespace-nowrap`}>
                {ad.liveAt ? (
                    <span className="tnum font-semibold text-ink">
                        {timeIn(ad.liveAt, timezone)}
                    </span>
                ) : (
                    <span className="text-ink-muted">Not yet</span>
                )}
                <p className="mt-0.5 text-xs text-ink-muted">
                    {ad.kind === "reactivated"
                        ? "Switched back on"
                        : ad.createdAt
                          ? `Created ${dayPrefix(ad.createdAt, timezone, today)}${timeIn(ad.createdAt, timezone)}`
                          : ""}
                </p>
            </td>
            <td className={`${cell} max-w-[300px]`}>
                <p className="break-words font-medium text-ink">{ad.ad_name}</p>
                {ad.firstDeliveryAt && (
                    <p className="mt-0.5 text-xs text-ink-muted">
                        First impression {timeIn(ad.firstDeliveryAt, timezone)}
                    </p>
                )}
            </td>
            <td className={`${cell} max-w-[240px] break-words text-ink-secondary`}>
                {ad.campaign_name || "—"}
            </td>
            <td className={`${cell} max-w-[240px] break-words text-ink-secondary`}>
                {ad.adset_name || "—"}
            </td>
            <td className={`${cell} whitespace-nowrap`}>
                <span
                    className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ color: s.color, background: s.bg }}
                >
                    {s.label}
                </span>
            </td>
            <td className={cell}>
                <div className="flex flex-col gap-1.5">
                    {preview && (
                        <a href={preview} target="_blank" rel="noopener noreferrer" className={link}>
                            <ExternalLink size={12} /> Preview
                        </a>
                    )}
                    {manager && (
                        <a href={manager} target="_blank" rel="noopener noreferrer" className={link}>
                            <ExternalLink size={12} /> Ads Manager
                        </a>
                    )}
                </div>
            </td>
        </tr>
    );
}
