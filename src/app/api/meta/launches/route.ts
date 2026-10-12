import { NextRequest, NextResponse } from "next/server";
import { LaunchedAd, LaunchesData } from "@/types/meta";
import {
    GRAPH_VERSION,
    MetaRequestError,
    fetchAllPages,
    getAccountTimeZone,
    nowIn,
} from "@/lib/metaGraph";

// Live marketing data — never cache this route at the framework level.
export const dynamic = "force-dynamic";

/**
 * Today's launches: ads that went live today, with the time they did.
 *
 * Built from the ad account's activity log (`/activities`), which records each
 * status change with a timestamp:
 *   - `create_ad`              — ad created
 *   - `update_ad_run_status`   — e.g. "Pending Review" → "Active" (approved)
 *   - `first_delivery_event`   — first impression served (once per ad)
 *
 * An ad counts as launched today when it was created or first delivered today,
 * or when an older ad was switched back on (Inactive/Paused → Active). Edits to
 * a running ad also cycle it through review back to "Active"; those are not
 * launches and are left out.
 *
 * The log also holds events for Meta's internal creative variants (names like
 * "..._Group_1"); they are not real ads, so the ads lookup simply drops them.
 */

interface Activity {
    event_time: string;
    event_type: string;
    object_id: string;
    object_type?: string;
    extra_data?: string;
}

interface AdMeta {
    id: string;
    name?: string;
    created_time?: string;
    effective_status?: string;
    preview_shareable_link?: string;
    campaign?: { name?: string };
    adset?: { name?: string };
}

const AD_FIELDS =
    "id,name,created_time,effective_status,preview_shareable_link,campaign{name},adset{name}";

/** Statuses an ad is in when someone has it switched off. */
const OFF_STATUSES = new Set(["Inactive", "Paused"]);

/** Local YYYY-MM-DD of an ISO timestamp in `timeZone`. */
function ymdIn(iso: string, timeZone: string): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(iso));
}

function runStatusChange(a: Activity): { from?: string; to?: string } {
    try {
        const x = JSON.parse(a.extra_data ?? "{}");
        return { from: x.old_value, to: x.new_value };
    } catch {
        return {};
    }
}

/** Generic paged GET for non-insights edges. */
async function fetchEdge<T>(firstUrl: string): Promise<T[]> {
    // fetchAllPages only needs `data` + `paging`; it is typed for insight rows.
    const rows = await fetchAllPages<never>(firstUrl);
    return rows as unknown as T[];
}

// Launches happen through the day; keep it short like the pace card.
const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; payload: LaunchesData }>();

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

    const base = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;
    const bypass = request.nextUrl.searchParams.get("fresh") === "1";

    const cached = cache.get("launches");
    if (!bypass && cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return NextResponse.json(cached.payload, {
            headers: { "x-cache": "hit" },
        });
    }

    try {
        const t0 = Date.now();
        const timezone = await getAccountTimeZone(base, token);
        const { today } = nowIn(timezone);

        // 26 h back always covers local midnight in any zone; trimmed to today below.
        const since = Math.floor(Date.now() / 1000) - 26 * 3600;
        const activities = (
            await fetchEdge<Activity>(
                `${base}/activities?fields=event_time,event_type,object_id,object_type,extra_data` +
                    `&since=${since}&limit=500&access_token=${token}`
            )
        ).filter(
            (a) => a.object_type === "ADGROUP" && ymdIn(a.event_time, timezone) === today
        );

        // Per ad, the earliest time of each event kind today.
        const earliest = (prev: string | undefined, t: string) =>
            !prev || Date.parse(t) < Date.parse(prev) ? t : prev;
        const created = new Map<string, string>();
        const delivered = new Map<string, string>();
        const activated = new Map<string, string>();
        const turnedOn = new Map<string, string>();
        for (const a of activities) {
            const id = a.object_id;
            if (a.event_type === "create_ad") {
                created.set(id, earliest(created.get(id), a.event_time));
            } else if (a.event_type === "first_delivery_event") {
                delivered.set(id, earliest(delivered.get(id), a.event_time));
            } else if (a.event_type === "update_ad_run_status") {
                const { from, to } = runStatusChange(a);
                if (to !== "Active") continue;
                activated.set(id, earliest(activated.get(id), a.event_time));
                if (from && OFF_STATUSES.has(from)) {
                    turnedOn.set(id, earliest(turnedOn.get(id), a.event_time));
                }
            }
        }

        const ids = [...new Set([...created.keys(), ...delivered.keys(), ...turnedOn.keys()])];

        // Look the ads up by id (50 per call). Ids that are not real ads (Meta's
        // internal variants) just don't come back.
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
        const metas = (
            await Promise.all(
                chunks.map((chunk) =>
                    fetchEdge<AdMeta>(
                        `${base}/ads?fields=${encodeURIComponent(AD_FIELDS)}&limit=100` +
                            `&filtering=${encodeURIComponent(
                                JSON.stringify([{ field: "id", operator: "IN", value: chunk }])
                            )}` +
                            `&access_token=${token}`
                    )
                )
            )
        ).flat();

        const numericAccount = accountId.replace(/^act_/, "");
        const ads: LaunchedAd[] = metas.map((m) => {
            const createdAt = created.get(m.id) ?? m.created_time ?? "";
            const isNew =
                created.has(m.id) ||
                delivered.has(m.id) ||
                (!!createdAt && ymdIn(createdAt, timezone) === today);
            return {
                ad_id: m.id,
                ad_name: m.name ?? m.id,
                campaign_name: m.campaign?.name ?? "",
                adset_name: m.adset?.name ?? "",
                status: m.effective_status ?? "UNKNOWN",
                kind: isNew ? "new" : "reactivated",
                createdAt,
                // A new ad goes live when review approves it; a reactivated one
                // when it was switched on. Fall back to first delivery.
                liveAt:
                    (isNew ? activated.get(m.id) : turnedOn.get(m.id)) ??
                    delivered.get(m.id) ??
                    null,
                firstDeliveryAt: delivered.get(m.id) ?? null,
                previewUrl: m.preview_shareable_link,
                adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${numericAccount}&selected_ad_ids=${m.id}`,
            };
        });

        // Most recent first; ads not live yet sort by when they were created.
        const sortKey = (a: LaunchedAd) => Date.parse(a.liveAt ?? a.createdAt) || 0;
        ads.sort((a, b) => sortKey(b) - sortKey(a));

        console.log(
            `[meta] launches (${timezone}): ${activities.length} events, ${ads.length} ads in ${Date.now() - t0}ms`
        );

        const payload: LaunchesData = { timezone, today, ads };
        cache.set("launches", { at: Date.now(), payload });
        return NextResponse.json(payload, { headers: { "x-cache": "miss" } });
    } catch (err) {
        const metaError =
            err instanceof MetaRequestError ? err.metaError : undefined;
        const message =
            err instanceof Error ? err.message : "Failed to reach the Meta API.";
        console.error("Meta launches API request failed:", message);

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
