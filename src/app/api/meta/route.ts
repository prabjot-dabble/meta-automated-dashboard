import { NextRequest, NextResponse } from "next/server";
import { DashboardData, MetaCampaign, MetaInsightsPage } from "@/types/meta";

// Live marketing data — never cache this route.
export const dynamic = "force-dynamic";

const GRAPH_VERSION = "v25.0";

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
    "cost_per_action_type",
].join(",");

/**
 * Formats a Date as a local `YYYY-MM-DD` string.
 *
 * We deliberately avoid `toISOString()` here: it converts to UTC, which for
 * IST (UTC+5:30) rolls local midnight back to the previous calendar day and
 * produced off-by-one month boundaries for `this_month` / `last_month`.
 */
function toLocalYMD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Meta transient error codes worth retrying. `code 1` / `error_subcode 99`
 * ("An unknown error occurred") and `code 2` are intermittent server-side
 * failures that Graph itself recommends retrying — they hit the default
 * `last_30d` view often enough to matter.
 */
function isTransientMetaError(error: { code?: number } | undefined): boolean {
    return error?.code === 1 || error?.code === 2;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetches and parses one Graph page, retrying transient failures (network
 * errors, non-JSON, transient Meta error codes) with linear backoff. Returns
 * the parsed page, or throws with a caller-friendly message on final failure.
 */
async function fetchPageWithRetry(pageUrl: string): Promise<MetaInsightsPage> {
    let lastError = "Meta API request failed.";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(pageUrl, { cache: "no-store" });
            const json = (await response.json()) as MetaInsightsPage;

            if (json.error) {
                if (isTransientMetaError(json.error) && attempt < MAX_ATTEMPTS) {
                    lastError = json.error.message;
                    await sleep(RETRY_BASE_MS * attempt);
                    continue;
                }
                // Non-transient (or out of attempts): surface Meta's error.
                throw new MetaRequestError(json.error.message, json.error);
            }

            return json;
        } catch (err) {
            if (err instanceof MetaRequestError) throw err;
            // Network / non-JSON failure — retry if attempts remain.
            lastError =
                err instanceof Error ? err.message : "Unknown network error.";
            if (attempt < MAX_ATTEMPTS) {
                await sleep(RETRY_BASE_MS * attempt);
                continue;
            }
        }
    }

    throw new MetaRequestError(lastError);
}

/** Carries a Meta error body so the handler can return it verbatim. */
class MetaRequestError extends Error {
    constructor(
        message: string,
        public readonly metaError?: MetaInsightsPage["error"]
    ) {
        super(message);
        this.name = "MetaRequestError";
    }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds the date portion of the Graph query.
 *
 * Precedence: an explicit custom range (`since`/`until`, both YYYY-MM-DD) wins;
 * otherwise `this_month`/`last_month` are expanded to a local time_range (to
 * dodge the UTC boundary bug); every other preset passes through as
 * `date_preset`.
 */
function buildDateQuery(
    datePreset: string,
    since: string | null,
    until: string | null
): string {
    if (since && until && YMD.test(since) && YMD.test(until)) {
        return `time_range={"since":"${since}","until":"${until}"}`;
    }

    const today = new Date();

    if (datePreset === "this_month") {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return `time_range={"since":"${toLocalYMD(firstDay)}","until":"${toLocalYMD(lastDay)}"}`;
    }

    if (datePreset === "last_month") {
        const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
        return `time_range={"since":"${toLocalYMD(firstDay)}","until":"${toLocalYMD(lastDay)}"}`;
    }

    return `date_preset=${encodeURIComponent(datePreset)}`;
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
    const rows: MetaCampaign[] = [];
    let nextUrl: string | null =
        `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/insights` +
        `?fields=${INSIGHT_FIELDS}` +
        `&level=campaign` +
        (daily ? `&time_increment=1` : ``) +
        `&use_unified_attribution_setting=true` +
        `&limit=500` +
        `&${dateQuery}` +
        `&access_token=${token}`;

    while (nextUrl) {
        const json = await fetchPageWithRetry(nextUrl);
        if (Array.isArray(json.data)) rows.push(...json.data);
        nextUrl = json.paging?.next ?? null;
    }

    return rows;
}

/**
 * In-memory response cache. Meta ad data for a given range changes slowly, and
 * repeated dashboard loads/refreshes must NOT each hit the Graph API — bursts
 * trip Meta's abuse protection. With this cache, Meta is called at most once
 * per range per TTL window, no matter how often the UI reloads.
 *
 * Process-local (fine for a single-instance dashboard). `?fresh=1` bypasses it.
 */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { at: number; payload: DashboardData }>();

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

    // Serve from cache unless it is stale or a fresh pull is explicitly asked.
    const cacheKey = dateQuery;
    const cached = cache.get(cacheKey);
    const bypass = params.get("fresh") === "1";
    if (!bypass && cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return NextResponse.json(cached.payload, {
            headers: { "x-cache": "hit" },
        });
    }

    try {
        // Period rows (exact totals) and daily rows (chart). Sequential to stay
        // gentle on rate limits.
        const campaigns = await fetchInsights(accountId, token, dateQuery, false);
        const daily = await fetchInsights(accountId, token, dateQuery, true);
        const payload: DashboardData = { campaigns, daily };
        cache.set(cacheKey, { at: Date.now(), payload });
        return NextResponse.json(payload, { headers: { "x-cache": "miss" } });
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
