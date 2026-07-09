/**
 * debug.ts — traceability helpers for validating dashboard numbers against
 * Meta Ads Manager / spreadsheets.
 *
 * For each metric we expose the full chain:
 *   Raw Meta value  →  Parsed value  →  Calculated (aggregated) value  →  Displayed string
 *
 * Pure functions only (no React). Rendered by `DebugPanel` behind `?debug=1`.
 */

import { MetaCampaign } from "@/types/meta";
import {
    aggregateByCampaign,
    computeTotals,
    formatCurrency,
    formatNumber,
    formatPercent,
    formatRoas,
    getPurchases,
    getRevenue,
    getRowRoas,
    PURCHASE_ACTION_TYPE_PRIORITY,
} from "@/lib/metrics";

export interface MetricTrace {
    metric: string;
    /** The raw value(s) as they arrived from the Graph API. */
    raw: string;
    /** The value after `Number(...)` coercion / canonical selection. */
    parsed: string;
    /** The aggregated / derived value used for display. */
    calculated: string;
    /** The final formatted string shown in the UI. */
    displayed: string;
}

/** Renders an action array as `type=value` pairs for the "raw" column. */
function rawActions(actions: MetaCampaign["actions"]): string {
    if (!actions || actions.length === 0) return "—";
    return actions.map((a) => `${a.action_type}=${a.value}`).join("  ");
}

/** Which canonical action type won the priority contest, for transparency. */
function canonicalType(actions: MetaCampaign["actions"]): string {
    if (!actions) return "none";
    for (const type of PURCHASE_ACTION_TYPE_PRIORITY) {
        if (actions.some((a) => a.action_type === type)) return type;
    }
    return "none";
}

/** Account-level trace: totals across all rows. */
export function buildAccountTrace(rows: MetaCampaign[]): MetricTrace[] {
    const totals = computeTotals(rows);
    const rowCount = rows.length;

    return [
        {
            metric: "Spend",
            raw: `${rowCount} rows · spend strings`,
            parsed: "Σ Number(spend)",
            calculated: String(totals.spend),
            displayed: formatCurrency(totals.spend),
        },
        {
            metric: "Revenue",
            raw: `action_values[${PURCHASE_ACTION_TYPE_PRIORITY.join(" > ")}]`,
            parsed: "Σ canonical action_value",
            calculated: String(totals.revenue),
            displayed: formatCurrency(totals.revenue),
        },
        {
            metric: "Purchases",
            raw: `actions[${PURCHASE_ACTION_TYPE_PRIORITY.join(" > ")}]`,
            parsed: "Σ canonical action count",
            calculated: String(totals.purchases),
            displayed: formatNumber(totals.purchases),
        },
        {
            metric: "ROAS",
            raw: "revenue / spend",
            parsed: `${totals.revenue} / ${totals.spend}`,
            calculated: String(totals.roas),
            displayed: formatRoas(totals.roas),
        },
        {
            metric: "CTR",
            raw: "clicks / impressions × 100",
            parsed: `${totals.clicks} / ${totals.impressions}`,
            calculated: String(totals.ctr),
            displayed: formatPercent(totals.ctr),
        },
        {
            metric: "Clicks",
            raw: `${rowCount} rows · clicks strings`,
            parsed: "Σ Number(clicks)",
            calculated: String(totals.clicks),
            displayed: formatNumber(totals.clicks),
        },
        {
            metric: "Impressions",
            raw: `${rowCount} rows · impressions strings`,
            parsed: "Σ Number(impressions)",
            calculated: String(totals.impressions),
            displayed: formatNumber(totals.impressions),
        },
        {
            metric: "Campaigns (unique)",
            raw: `${rowCount} campaign-day rows`,
            parsed: "Set(campaign_id)",
            calculated: String(totals.campaignCount),
            displayed: formatNumber(totals.campaignCount),
        },
    ];
}

export interface CampaignTraceRow {
    campaign_id: string;
    campaign_name: string;
    days: number;
    spend: number;
    revenue: number;
    purchases: number;
    roas: number;
    displayedSpend: string;
    displayedRevenue: string;
    displayedRoas: string;
}

/** Per-campaign trace (aggregated), sorted by spend descending. */
export function buildCampaignTrace(rows: MetaCampaign[]): CampaignTraceRow[] {
    return aggregateByCampaign(rows).map((c) => ({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        days: c.days,
        spend: c.spend,
        revenue: c.revenue,
        purchases: c.purchases,
        roas: c.roas,
        displayedSpend: formatCurrency(c.spend),
        displayedRevenue: formatCurrency(c.revenue),
        displayedRoas: formatRoas(c.roas),
    }));
}

export interface RowTrace {
    campaign_name: string;
    date: string;
    rawSpend: string;
    rawActionValues: string;
    canonicalRevenueType: string;
    revenue: number;
    purchases: number;
    rowRoas: number;
}

/**
 * Row-level trace for a single campaign (by id) — shows exactly which action
 * type won per campaign-day, so a spreadsheet reviewer can see why a number
 * came out the way it did.
 */
export function buildRowTrace(
    rows: MetaCampaign[],
    campaignId: string
): RowTrace[] {
    return rows
        .filter((r) => r.campaign_id === campaignId)
        .sort((a, b) => a.date_start.localeCompare(b.date_start))
        .map((r) => ({
            campaign_name: r.campaign_name,
            date: r.date_start,
            rawSpend: r.spend,
            rawActionValues: rawActions(r.action_values),
            canonicalRevenueType: canonicalType(r.action_values),
            revenue: getRevenue(r),
            purchases: getPurchases(r),
            rowRoas: getRowRoas(r),
        }));
}
