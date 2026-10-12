import { NextRequest, NextResponse } from "next/server";
import { MetaCampaign, PaceData, PaceHour } from "@/types/meta";
import {
    getPurchases,
    getRevenue,
    toNumber,
    TRACKED_ACTION_TYPES,
} from "@/lib/metrics";
import {
    GRAPH_VERSION,
    MetaRequestError,
    fetchAllPages,
    getAccountTimeZone,
    nowIn,
    trimActionTypes,
} from "@/lib/metaGraph";

// Live marketing data — never cache this route at the framework level.
export const dynamic = "force-dynamic";

/**
 * Spend pace: account-level HOURLY totals for yesterday and today, so the UI can
 * compare today so far with yesterday at the same time of day. Hours are in the
 * ad account's own time zone (Meta's `hourly_stats_aggregated_by_advertiser_time_zone`),
 * and "now" is computed in that same zone. About 50 rows, so it is cheap.
 */

const HOUR_KEY = "hourly_stats_aggregated_by_advertiser_time_zone";
type HourRow = MetaCampaign & { [HOUR_KEY]: string };

// Today moves all day, but the data is small; a short cache keeps refreshes cheap.
const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; payload: PaceData }>();

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

    const cached = cache.get("pace");
    if (!bypass && cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return NextResponse.json(cached.payload, {
            headers: { "x-cache": "hit" },
        });
    }

    try {
        const t0 = Date.now();
        const timezone = await getAccountTimeZone(base, token);
        const now = nowIn(timezone);

        const url =
            `${base}/insights?level=account&time_increment=1` +
            `&breakdowns=${HOUR_KEY}` +
            `&fields=spend,actions,action_values` +
            `&use_unified_attribution_setting=true&limit=100` +
            `&time_range={"since":"${now.yesterday}","until":"${now.today}"}` +
            `&access_token=${token}`;
        const rows = await fetchAllPages<HourRow>(url);
        trimActionTypes(rows, TRACKED_ACTION_TYPES);

        const todayHours: PaceHour[] = [];
        const yesterdayHours: PaceHour[] = [];
        for (const row of rows) {
            const hour: PaceHour = {
                h: parseInt(row[HOUR_KEY].slice(0, 2), 10),
                spend: toNumber(row.spend),
                purchases: getPurchases(row),
                revenue: getRevenue(row),
            };
            (row.date_start === now.today ? todayHours : yesterdayHours).push(hour);
        }
        console.log(
            `[meta] pace (${timezone}): ${rows.length} hourly rows in ${Date.now() - t0}ms`
        );

        const payload: PaceData = {
            timezone,
            today: now.today,
            yesterday: now.yesterday,
            hour: now.hour,
            minute: now.minute,
            todayHours,
            yesterdayHours,
        };
        cache.set("pace", { at: Date.now(), payload });
        return NextResponse.json(payload, { headers: { "x-cache": "miss" } });
    } catch (err) {
        const metaError =
            err instanceof MetaRequestError ? err.metaError : undefined;
        const message =
            err instanceof Error ? err.message : "Failed to reach the Meta API.";
        console.error("Meta pace API request failed:", message);

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
