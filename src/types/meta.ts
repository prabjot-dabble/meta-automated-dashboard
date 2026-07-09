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
    clicks: string;

    cpc: string;
    cpm: string;
    ctr: string;

    actions?: MetaAction[];
    action_values?: MetaAction[];
    purchase_roas?: MetaAction[];
    cost_per_action_type?: MetaAction[];

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
}

/** Error object returned by the Graph API (HTTP 200 with an `error` body). */
export interface MetaApiError {
    message: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
}
