import { NextRequest, NextResponse } from "next/server";
import { DashboardData, MetaCampaign } from "@/types/meta";
import { TRACKED_ACTION_TYPES } from "@/lib/metrics";
import { DiskCache } from "@/lib/diskCache";
import {
    GRAPH_VERSION,
    MetaRequestError,
    buildDateQuery,
    resolveRange,
    cacheTtlMs,
    previousRange,
    fetchAllPages,
    trimActionTypes,
    toLocalYMD,
} from "@/lib/metaGraph";

// Live marketing data — never cache this route.
export const dynamic = "force-dynamic";

const INSIGHT_FIELDS = [
    "campaign_name",
    "campaign_id",
    "date_start",
    "date_stop",
    "spend",
    "impressions",
    "reach",
    "clicks",
    "cpc",
    "cpm",
    "ctr",
    "actions",
    "action_values",
    "purchase_roas",
].join(",");

// The trend chart only needs date, spend, purchases and revenue. A lean field
// list keeps the campaign×day query (the heaviest one) small and less likely to
// trip Meta's transient "service unavailable" errors.
const DAILY_FIELDS = [
    "campaign_name",
    "campaign_id",
    "date_start",
    "date_stop",
    "spend",
    "actions",
    "action_values",
].join(",");

// Meta's time_increment=1 cost grows ~linearly with days (~1.2s/day measured),
// so a 30-day query outlives the request timeout. Weekly chunks run in parallel
// (capped, to stay gentle on rate limits) each finish well inside it.
const DAILY_CHUNK_DAYS = 7;
const DAILY_CONCURRENCY = 4;

async function fetchDailyChunked(
    accountId: string,
    token: string,
    dateQuery: string,
    range: { since: Date; until: Date } | null
): Promise<MetaCampaign[]> {
    if (!range) return fetchInsights(accountId, token, dateQuery, true);

    const chunks: string[] = [];
    for (
        let start = new Date(range.since);
        start <= range.until;
        start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + DAILY_CHUNK_DAYS)
    ) {
        const end = new Date(
            start.getFullYear(),
            start.getMonth(),
            start.getDate() + DAILY_CHUNK_DAYS - 1
        );
        const last = end > range.until ? range.until : end;
        chunks.push(
            `time_range={"since":"${toLocalYMD(start)}","until":"${toLocalYMD(last)}"}`
        );
    }
    if (chunks.length <= 1) return fetchInsights(accountId, token, dateQuery, true);

    const results: MetaCampaign[][] = new Array(chunks.length);
    let next = 0;
    const worker = async () => {
        while (next < chunks.length) {
            const i = next++;
            results[i] = await fetchInsights(accountId, token, chunks[i], true);
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(DAILY_CONCURRENCY, chunks.length) }, worker)
    );
    return results.flat();
}

/**
 * Fetches all pages of a campaign insights query.
 *
 * `daily=false` → one row per campaign for the whole range (period totals that
 * match Ads Manager exactly — used for KPIs and the table). `daily=true` →
 * one row per campaign-day (`time_increment=1`, used for the trend chart).
 *
 * `use_unified_attribution_setting=true` mirrors each campaign's own Ads
 * Manager attribution window (this account mixes several), so numbers match.
 */
async function fetchInsights(
    accountId: string,
    token: string,
    dateQuery: string,
    daily: boolean
): Promise<MetaCampaign[]> {
    const url =
        `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/insights` +
        `?fields=${daily ? DAILY_FIELDS : INSIGHT_FIELDS}` +
        `&level=campaign` +
        (daily ? `&time_increment=1` : ``) +
        `&use_unified_attribution_setting=true` +
        `&limit=500` +
        `&${dateQuery}` +
        `&access_token=${token}`;

    return trimActionTypes(
        await fetchAllPages<MetaCampaign>(url),
        TRACKED_ACTION_TYPES
    );
}

/**
 * In-memory response cache, kept per part ("totals" / "daily") so the UI can
 * load the fast totals first and the slow daily rows separately. Meta ad data
 * for a given range changes slowly, and repeated dashboard loads/refreshes must
 * NOT each hit the Graph API — bursts trip Meta's abuse protection.
 *
 * Lifetime depends on how settled the range is (see `cacheTtlMs`): 5 min when
 * it includes today, 30 min for the last week, 24 h for older ranges.
 *
 * Also saved to disk (see `DiskCache`), so restarts keep it. `?fresh=1` bypasses it.
 */
type Part = "totals" | "daily" | "prev";
const cache = new DiskCache<{
    at: number;
    ttl: number;
    rows: MetaCampaign[];
}>("meta-campaigns");

type PartResult = {
    rows: MetaCampaign[];
    status: "hit" | "miss" | "stale";
    at: number;
};

export async function GET(request: NextRequest) {
    const token = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID;

    // Fail fast with a clear message rather than sending `undefined` to Graph.
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
    const datePreset = params.get("datePreset") || "last_30d";
    const dateQuery = buildDateQuery(
        datePreset,
        params.get("since"),
        params.get("until")
    );
    const range = resolveRange(datePreset, params.get("since"), params.get("until"));
    const bypass = params.get("fresh") === "1";

    // `?part=totals|daily` fetches one half; no `part` returns both (legacy).
    const partParam = params.get("part");
    const parts: Part[] =
        partParam === "totals"
            ? ["totals"]
            : partParam === "daily"
              ? ["daily"]
              : partParam === "prev"
                ? ["prev"]
                : ["totals", "daily"];

    // Previous period of the same length, for "vs previous" deltas. Null when a
    // comparison isn't meaningful (see previousRange).
    const prev = range ? previousRange(range) : null;

    /** Cache lookup → Graph fetch → stale fallback, for one part. */
    async function loadPart(part: Part): Promise<PartResult> {
        if (part === "prev" && !prev) {
            return { rows: [], status: "hit", at: Date.now() };
        }
        const cacheKey = `${dateQuery}|${part}`;
        const cached = cache.get(cacheKey);
        if (!bypass && cached && Date.now() - cached.at < cached.ttl) {
            return { rows: cached.rows, status: "hit", at: cached.at };
        }

        try {
            const t0 = Date.now();
            const rows =
                part === "totals"
                    ? await fetchInsights(accountId!, token!, dateQuery, false)
                    : part === "prev"
                      ? await fetchInsights(
                            accountId!,
                            token!,
                            `time_range={"since":"${toLocalYMD(prev!.since)}","until":"${toLocalYMD(prev!.until)}"}`,
                            false
                        )
                      : await fetchDailyChunked(accountId!, token!, dateQuery, range);
            console.log(
                `[meta] campaign ${part}: ${rows.length} rows in ${Date.now() - t0}ms`
            );
            // Unknown range → shortest TTL (treat as "includes today"). The
            // previous period ended before the selected one began, so it settles
            // on its own (older) schedule.
            const ttlEnd = part === "prev" ? prev?.until : range?.until;
            const ttl = ttlEnd ? cacheTtlMs(ttlEnd) : 5 * 60 * 1000;
            const at = Date.now();
            cache.set(cacheKey, { at, ttl, rows });
            return { rows, status: "miss", at };
        } catch (err) {
            // Serve the last good data (however old) rather than an error page.
            if (cached) {
                console.error(
                    `Meta ${part} request failed, serving stale:`,
                    err instanceof Error ? err.message : err
                );
                return { rows: cached.rows, status: "stale", at: cached.at };
            }
            throw err;
        }
    }

    try {
        // Independent parts run in parallel.
        const results = await Promise.all(parts.map(loadPart));
        const byPart = Object.fromEntries(
            parts.map((p, i) => [p, results[i]])
        ) as Partial<Record<Part, PartResult>>;

        const payload: Partial<DashboardData> = {};
        if (byPart.totals) payload.campaigns = byPart.totals.rows;
        if (byPart.daily) payload.daily = byPart.daily.rows;
        if (byPart.prev) {
            payload.previous = prev ? byPart.prev.rows : null;
            payload.previousRange = prev
                ? { since: toLocalYMD(prev.since), until: toLocalYMD(prev.until) }
                : null;
        }

        const stale = results.filter((r) => r.status === "stale");
        const headers: Record<string, string> = {};
        if (stale.length > 0) {
            headers["x-cache"] = "stale";
            headers["x-cache-at"] = String(Math.min(...stale.map((r) => r.at)));
        } else {
            headers["x-cache"] = results.every((r) => r.status === "hit")
                ? "hit"
                : "miss";
        }
        return NextResponse.json(payload, { headers });
    } catch (err) {
        const metaError =
            err instanceof MetaRequestError ? err.metaError : undefined;
        const message =
            err instanceof Error ? err.message : "Failed to reach the Meta API.";
        console.error("Meta API request failed:", message);
        return NextResponse.json(
            { error: metaError ?? { message } },
            { status: 502 }
        );
    }
}
