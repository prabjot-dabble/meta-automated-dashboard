import { NextRequest, NextResponse } from "next/server";
import { MetaAdRow, WeeklyAdsData } from "@/types/meta";
import { TRACKED_ACTION_TYPES } from "@/lib/metrics";
import { DiskCache } from "@/lib/diskCache";
import {
    GRAPH_VERSION,
    MetaRequestError,
    cacheTtlMs,
    fetchAllPages,
    trimActionTypes,
    toLocalYMD,
} from "@/lib/metaGraph";

// Live marketing data — never cache this route.
export const dynamic = "force-dynamic";

/**
 * Ad-level fields. `reach` is intentionally omitted: it is not additive across
 * weeks/ads and nothing in the weekly view uses it. The `actions` /
 * `action_values` arrays carry purchases, LPV, ATC and checkout events.
 */
const AD_FIELDS = [
    "ad_name",
    "ad_id",
    "campaign_name",
    "campaign_id",
    "date_start",
    "date_stop",
    "spend",
    "impressions",
    "clicks",
    "actions",
    "action_values",
].join(",");

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MIN_WEEKS = 1;
const MAX_WEEKS = 12;
const WEEKS_PER_CHUNK = 3;
const CHUNK_CONCURRENCY = 4;

/**
 * Weekly window resolution.
 *
 * `?anchor=YYYY-MM-DD&weeks=N` → N consecutive 7-day buckets **ending at the
 * anchor date** (inclusive): since = anchor − (7·N − 1) days. The Graph query
 * uses `time_increment=7`, which cuts the range into 7-day windows starting at
 * `since` — so the buckets land exactly on [anchor−6 … anchor], the week
 * before that, and so on. Verified against the manual weekly report
 * (10–16 Jun … 1–7 Jul 2026): totals reproduce to the rupee.
 *
 * Dates are parsed as LOCAL dates (never `new Date("YYYY-MM-DD")`, which is
 * UTC) to avoid the IST off-by-one — same rule as toLocalYMD.
 */
function resolveWindow(
    anchorParam: string | null,
    weeksParam: string | null
): { since: string; until: string; weeks: number } {
    const parsed = parseInt(weeksParam ?? "", 10);
    const weeks = Math.min(
        MAX_WEEKS,
        Math.max(MIN_WEEKS, Number.isFinite(parsed) ? parsed : 4)
    );

    // Default anchor: yesterday (the last fully completed day).
    let anchor: Date;
    if (anchorParam && YMD.test(anchorParam)) {
        const [y, m, d] = anchorParam.split("-").map(Number);
        anchor = new Date(y, m - 1, d);
    } else {
        anchor = new Date();
        anchor.setDate(anchor.getDate() - 1);
    }

    const since = new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        anchor.getDate() - (7 * weeks - 1)
    );

    return { since: toLocalYMD(since), until: toLocalYMD(anchor), weeks };
}

/** Same cache policy as `/api/meta`: TTL depends on how settled the window is. */
const cache = new DiskCache<{
    at: number;
    ttl: number;
    payload: WeeklyAdsData;
}>("meta-weekly");

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
    const { since, until, weeks } = resolveWindow(
        params.get("anchor"),
        params.get("weeks")
    );

    const cacheKey = `${since}..${until}`;
    const cached = cache.get(cacheKey);
    const bypass = params.get("fresh") === "1";
    if (!bypass && cached && Date.now() - cached.at < cached.ttl) {
        return NextResponse.json(cached.payload, {
            headers: { "x-cache": "hit" },
        });
    }

    const urlFor = (from: string, to: string) =>
        `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/insights` +
        `?fields=${AD_FIELDS}` +
        `&level=ad` +
        `&time_increment=7` +
        `&use_unified_attribution_setting=true` +
        `&limit=500` +
        `&time_range={"since":"${from}","until":"${to}"}` +
        `&access_token=${token}`;

    try {
        // Query cost grows ~linearly with weeks, so split into WEEKS_PER_CHUNK
        // windows (aligned to the 7-day buckets, so results are identical) and
        // fetch them in parallel, capped to stay gentle on rate limits.
        const [sy, sm, sd] = since.split("-").map(Number);
        const chunkUrls: string[] = [];
        for (let w = 0; w < weeks; w += WEEKS_PER_CHUNK) {
            const from = new Date(sy, sm - 1, sd + w * 7);
            const lastWeek = Math.min(w + WEEKS_PER_CHUNK, weeks);
            const to = new Date(sy, sm - 1, sd + lastWeek * 7 - 1);
            chunkUrls.push(urlFor(toLocalYMD(from), toLocalYMD(to)));
        }

        const t0 = Date.now();
        const results: MetaAdRow[][] = new Array(chunkUrls.length);
        let next = 0;
        const worker = async () => {
            while (next < chunkUrls.length) {
                const i = next++;
                results[i] = trimActionTypes(
                    await fetchAllPages<MetaAdRow>(chunkUrls[i]),
                    TRACKED_ACTION_TYPES
                );
            }
        };
        await Promise.all(
            Array.from(
                { length: Math.min(CHUNK_CONCURRENCY, chunkUrls.length) },
                worker
            )
        );
        const ads = results.flat();
        console.log(
            `[meta] weekly ads: ${ads.length} rows, ${chunkUrls.length} chunk(s) in ${Date.now() - t0}ms`
        );
        const payload: WeeklyAdsData = { ads, since, until, weeks };
        const [uy, um, ud] = until.split("-").map(Number);
        cache.set(cacheKey, {
            at: Date.now(),
            ttl: cacheTtlMs(new Date(uy, um - 1, ud)),
            payload,
        });
        return NextResponse.json(payload, { headers: { "x-cache": "miss" } });
    } catch (err) {
        const metaError =
            err instanceof MetaRequestError ? err.metaError : undefined;
        const message =
            err instanceof Error ? err.message : "Failed to reach the Meta API.";
        console.error("Meta weekly API request failed:", message);

        // Serve the last good data (however old) rather than an error page.
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
