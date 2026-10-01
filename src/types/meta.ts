/**
 * Types mirroring the Meta Graph API `insights` response.
 *
 * All numeric fields arrive from the Graph API as **strings** and must be
 * coerced with `Number(...)` at use sites. The action arrays are **omitted
 * entirely** by Meta on rows with zero conversions, so they are optional here
 * — the `?.` guards throughout the codebase are load-bearing, not defensive
 * noise.
 */

export interface MetaAction {
    action_type: string;
    value: string;
}

export interface MetaCampaign {
    campaign_name: string;
    campaign_id: string;

    spend: string;
    impressions: string;
    reach: string;
    /** Avg times each person saw the ad (period-level; only on ad queries). */
    frequency?: string;
    clicks: string;

    cpc: string;
    cpm: string;
    ctr: string;

    actions?: MetaAction[];
    action_values?: MetaAction[];
    purchase_roas?: MetaAction[];
    cost_per_action_type?: MetaAction[];

    /** ThruPlays (15s or complete). Only requested on the ad-level query. */
    video_thruplay_watched_actions?: MetaAction[];
    /** Average seconds watched per play. Only requested on the ad-level query. */
    video_avg_time_watched_actions?: MetaAction[];

    date_start: string;
    date_stop: string;
}

/** A single page of the Graph API cursor-paginated response. */
export interface MetaInsightsPage {
    data?: MetaCampaign[];
    paging?: {
        next?: string;
        cursors?: {
            before?: string;
            after?: string;
        };
    };
    error?: MetaApiError;
}

/**
 * Shape returned by our `/api/meta` route: period-level rows (one per campaign,
 * exact Ads Manager totals — for KPIs/table) and daily rows (per campaign-day —
 * for the trend chart).
 */
export interface DashboardData {
    campaigns: MetaCampaign[];
    daily: MetaCampaign[];
    /**
     * Totals for the equally long period immediately before the selected one
     * (`?part=prev`), for "vs previous" deltas. `null` when no comparison is
     * meaningful (e.g. "today", or a range we can't resolve to dates).
     */
    previous?: MetaCampaign[] | null;
    previousRange?: { since: string; until: string } | null;
}

/**
 * One ad-level insights row. With `time_increment=7` each row is an
 * **ad-week**: `date_start`/`date_stop` bound one 7-day bucket, aligned to the
 * query's `since` date.
 */
export interface MetaAdRow extends MetaCampaign {
    ad_id: string;
    ad_name: string;
}

/** One hour of account-level performance (advertiser time zone). */
export interface PaceHour {
    /** 0-23 */
    h: number;
    spend: number;
    purchases: number;
    revenue: number;
}

/**
 * Shape returned by our `/api/meta/pace` route: hourly totals for yesterday and
 * today, plus "now" expressed in the ad account's own time zone (so the
 * comparison stays correct wherever the server or browser is running).
 */
export interface PaceData {
    timezone: string;
    today: string;
    yesterday: string;
    /** Current hour (0-23) and minute in the account's time zone. */
    hour: number;
    minute: number;
    todayHours: PaceHour[];
    yesterdayHours: PaceHour[];
}

/** Creative format, derived from the ad's Meta creative object. */
export type AdFormat = "video" | "carousel" | "static" | "unknown";

/**
 * One row of the Creative Insights table: ad-level insights for the selected
 * range, joined with the ad's delivery status and creative format. Live ads
 * that delivered nothing in the range appear with zeroed metrics.
 */
export interface MetaLiveAd extends MetaAdRow {
    /** Meta `effective_status`, e.g. ACTIVE, PAUSED, ADSET_PAUSED. */
    status: string;
    format: AdFormat;
    /** Shareable link that shows the ad the way people see it (Meta-hosted). */
    previewUrl?: string;
    /** Opens this ad in Ads Manager (to edit, pause or change budget). */
    adsManagerUrl?: string;
}

/** Shape returned by our `/api/meta/ads` route. */
export interface CreativeInsightsData {
    ads: MetaLiveAd[];
    scope: "live" | "all";
}

/**
 * Shape returned by our `/api/meta/weekly` route: raw ad-week rows plus the
 * exact window the server resolved (weeks × 7 days ending at the anchor).
 */
export interface WeeklyAdsData {
    ads: MetaAdRow[];
    since: string;
    until: string;
    weeks: number;
}

/** Error object returned by the Graph API (HTTP 200 with an `error` body). */
export interface MetaApiError {
    message: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
}
