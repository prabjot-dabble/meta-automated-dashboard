import { NextRequest, NextResponse } from "next/server";
import {
    AdFormat,
    CreativeInsightsData,
    MetaAdRow,
    MetaLiveAd,
} from "@/types/meta";
import { DiskCache } from "@/lib/diskCache";
import {
    TRACKED_ACTION_TYPES,
    getVideoViews3s,
    toNumber,
} from "@/lib/metrics";
import {
    GRAPH_VERSION,
    MetaRequestError,
    buildDateQuery,
    fetchAllPages,
    fetchPageWithRetry,
    trimActionTypes,
} from "@/lib/metaGraph";

// Live marketing data — never cache this route at the framework level.
export const dynamic = "force-dynamic";

/**
 * Creative Insights: which individual ADS are working. Ad-level insights for
 * the selected range, joined with each ad's live status and creative format.
 *
 * Default scope is LIVE ads only (`effective_status = ACTIVE`, i.e. the ad,
 * its ad set and its campaign are all on). `?scope=all` also returns ads that
 * spent in the range but are no longer live.
 *
 * Three independent Graph calls run in parallel:
 *   1. insights  — spend / impressions / clicks / actions per ad
 *   2. live ads  — id, name, status, creative format (ACTIVE ads only; creative
 *                  expansion is slow, so it is never requested for the whole
 *                  500+ ad history)
 *   3. statuses  — id + status for every ad (scope=all only)
 */

const INSIGHT_FIELDS = [
    "ad_id",
    "ad_name",
    "campaign_name",
    "campaign_id",
    "date_start",
    "date_stop",
    "spend",
    "impressions",
    "reach",
    "frequency",
    "clicks",
    "ctr",
    "actions",
    "action_values",
    "video_thruplay_watched_actions",
    "video_avg_time_watched_actions",
].join(",");

// Minimal creative expansion: enough to tell video / carousel / static apart.
const LIVE_AD_FIELDS =
    "id,name,effective_status,preview_shareable_link,campaign{name},creative{object_type,video_id,object_story_spec{link_data{child_attachments{name}}}}";

const filter = (field: string, value: string[]) =>
    encodeURIComponent(JSON.stringify([{ field, operator: "IN", value }]));

interface LiveAdMeta {
    id: string;
    name?: string;
    effective_status: string;
    preview_shareable_link?: string;
    campaign?: { name?: string };
    creative?: {
        object_type?: string;
        video_id?: string;
        object_story_spec?: {
            link_data?: { child_attachments?: unknown[] };
        };
    };
}

interface StatusOnly {
    id: string;
    effective_status: string;
}

function formatOf(meta: LiveAdMeta | undefined): AdFormat {
    const c = meta?.creative;
    if (!c) return "unknown";
    const children = c.object_story_spec?.link_data?.child_attachments;
    if (Array.isArray(children) && children.length > 1) return "carousel";
    if (c.video_id || c.object_type === "VIDEO") return "video";
    if (c.object_type) return "static";
    return "unknown";
}

/**
 * Share of impressions that must be 3-second video plays before a creative that
 * does not say "video" is treated as one. Many video ads are "shared posts" whose
 * creative type is generic, so they look static; real ones clear this easily
 * (video ads here run ~10-40%). Static and carousel ads can still log a handful
 * of stray video plays (under ~1%), which must not turn them into videos.
 */
const INFER_VIDEO_MIN_PLAY_RATE = 0.02;

function finalFormat(meta: LiveAdMeta | undefined, row: MetaAdRow): AdFormat {
    const fromCreative = formatOf(meta);
    if (fromCreative === "carousel" || fromCreative === "video") {
        return fromCreative;
    }
    const impressions = toNumber(row.impressions);
    const playRate =
        impressions > 0 ? getVideoViews3s(row) / impressions : 0;
    return playRate >= INFER_VIDEO_MIN_PLAY_RATE ? "video" : fromCreative;
}

/**
 * Preview links for a specific set of ads, fetched in batches of 50 by id.
 *
 * Not requested on the big all-ads status list: this account has thousands of
 * ads and generating a link for each adds ~18 s. Links are a convenience, so a
 * failed batch just means those rows have no preview button.
 */
async function fetchPreviewLinks(
    ids: string[],
    token: string
): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

    await Promise.all(
        chunks.map(async (chunk) => {
            try {
                const json = (await fetchPageWithRetry(
                    `https://graph.facebook.com/${GRAPH_VERSION}/?ids=${chunk.join(",")}` +
                        `&fields=preview_shareable_link&access_token=${token}`
                )) as unknown as Record<string, { preview_shareable_link?: string }>;
                for (const id of chunk) {
                    const link = json[id]?.preview_shareable_link;
                    if (link) out.set(id, link);
                }
            } catch {
                // optional data: skip this batch
            }
        })
    );
    return out;
}

/** Generic paged GET for non-insights edges (ads list). */
async function fetchEdge<T>(firstUrl: string): Promise<T[]> {
    // fetchAllPages only needs `data` + `paging`; it is typed for insight rows.
    const rows = await fetchAllPages<never>(firstUrl);
    return rows as unknown as T[];
}

// Live status changes (ads get paused), so keep this short regardless of range.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new DiskCache<{
    at: number;
    payload: CreativeInsightsData;
}>("meta-ads");

export async function GET(request: NextRequest) {
    const token = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;

    if (!token || !accountId) {
        return NextResponse.json(
            {
                error: {
                    message:
                        "Server is missing META_ACCESS_TOKEN and/or META_AD_ACCOUNT_ID environment variables.",
                },
            },
            { status: 500 }
        );
    }

    const params = request.nextUrl.searchParams;
    const scope: "live" | "all" = params.get("scope") === "all" ? "all" : "live";
    const dateQuery = buildDateQuery(
        params.get("datePreset") || "last_30d",
        params.get("since"),
        params.get("until")
    );

    const cacheKey = `${dateQuery}|${scope}`;
    const cached = cache.get(cacheKey);
    const bypass = params.get("fresh") === "1";
    if (!bypass && cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return NextResponse.json(cached.payload, {
            headers: { "x-cache": "hit" },
        });
    }

    const base = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;
    const insightsUrl =
        `${base}/insights?fields=${INSIGHT_FIELDS}` +
        `&level=ad` +
        `&use_unified_attribution_setting=true` +
        `&limit=500` +
        (scope === "live"
            ? `&filtering=${filter("ad.effective_status", ["ACTIVE"])}`
            : ``) +
        `&${dateQuery}` +
        `&access_token=${token}`;
    const liveUrl =
        `${base}/ads?fields=${encodeURIComponent(LIVE_AD_FIELDS)}` +
        `&limit=100` +
        `&filtering=${filter("effective_status", ["ACTIVE"])}` +
        `&access_token=${token}`;
    const statusUrl =
        `${base}/ads?fields=id,effective_status&limit=500` +
        `&access_token=${token}`;

    try {
        const t0 = Date.now();
        const [insights, liveAds, statuses] = await Promise.all([
            fetchAllPages<MetaAdRow>(insightsUrl),
            fetchEdge<LiveAdMeta>(liveUrl),
            scope === "all"
                ? fetchEdge<StatusOnly>(statusUrl)
                : Promise.resolve<StatusOnly[]>([]),
        ]);
        console.log(
            `[meta] ads (${scope}): ${insights.length} insight rows, ${liveAds.length} live ads in ${Date.now() - t0}ms`
        );

        trimActionTypes(insights, TRACKED_ACTION_TYPES);

        const liveById = new Map(liveAds.map((a) => [a.id, a]));
        const statusById = new Map(
            statuses.map((s) => [s.id, s.effective_status])
        );
        // Live ads already carry their link; only fetch it for the others shown.
        const previewById = await fetchPreviewLinks(
            insights.map((r) => r.ad_id).filter((id) => !liveById.has(id)),
            token
        );
        // Ads Manager deep link: numeric account id, the ad preselected.
        const numericAccount = accountId.replace(/^act_/, "");
        const adsManagerUrl = (adId: string) =>
            `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${numericAccount}&selected_ad_ids=${adId}`;
        const seen = new Set<string>();

        const ads: MetaLiveAd[] = [];
        for (const row of insights) {
            seen.add(row.ad_id);
            const live = liveById.get(row.ad_id);
            ads.push({
                ...row,
                status: live
                    ? live.effective_status
                    : (statusById.get(row.ad_id) ?? "UNKNOWN"),
                format: finalFormat(live, row),
                previewUrl:
                    live?.preview_shareable_link ?? previewById.get(row.ad_id),
                adsManagerUrl: adsManagerUrl(row.ad_id),
            });
        }

        // Live ads that delivered nothing in the range are still "live but not
        // working" — surface them with zeroed metrics instead of hiding them.
        for (const live of liveAds) {
            if (seen.has(live.id)) continue;
            ads.push({
                ad_id: live.id,
                ad_name: live.name ?? live.id,
                campaign_id: "",
                campaign_name: live.campaign?.name ?? "",
                date_start: "",
                date_stop: "",
                spend: "0",
                impressions: "0",
                clicks: "0",
                reach: "0",
                frequency: "0",
                cpc: "0",
                cpm: "0",
                ctr: "0",
                status: live.effective_status,
                format: formatOf(live),
                previewUrl: live.preview_shareable_link,
                adsManagerUrl: adsManagerUrl(live.id),
            });
        }

        // Meta's ACTIVE filter also lets through ads that are WITH_ISSUES or whose
        // ad set is paused. "Live" here means strictly ACTIVE.
        const payload: CreativeInsightsData = {
            ads: scope === "live" ? ads.filter((a) => a.status === "ACTIVE") : ads,
            scope,
        };
        cache.set(cacheKey, { at: Date.now(), payload });
        return NextResponse.json(payload, { headers: { "x-cache": "miss" } });
    } catch (err) {
        const metaError =
            err instanceof MetaRequestError ? err.metaError : undefined;
        const message =
            err instanceof Error ? err.message : "Failed to reach the Meta API.";
        console.error("Meta ads API request failed:", message);

        if (cached) {
            return NextResponse.json(cached.payload, {
                headers: {
                    "x-cache": "stale",
                    "x-cache-at": String(cached.at),
                },
            });
        }
        return NextResponse.json(
            { error: metaError ?? { message } },
            { status: 502 }
        );
    }
}
