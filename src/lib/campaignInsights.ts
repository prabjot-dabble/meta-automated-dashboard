/**
 * campaignInsights.ts — campaign rankings for the Executive Insights section.
 *
 * These operate on `CampaignAggregate[]` (one entry per campaign, already
 * summed/derived by `aggregateByCampaign`). They must NOT be given raw
 * campaign-day rows: with `time_increment=1` that would rank single lucky days
 * and show the same campaign repeatedly.
 */

import { CampaignAggregate } from "@/lib/metrics";

export interface CampaignInsight {
    campaign_id: string;
    name: string;
    /** The metric this ranking is sorted by (ROAS or spend). */
    value: number;
    spend: number;
    revenue: number;
}

function toInsight(
    campaign: CampaignAggregate,
    value: number
): CampaignInsight {
    return {
        campaign_id: campaign.campaign_id,
        name: campaign.campaign_name,
        value,
        spend: campaign.spend,
        revenue: campaign.revenue,
    };
}

/** Top N campaigns by ROAS (descending). */
export function getTopCampaignsByROAS(
    campaigns: CampaignAggregate[],
    count = 5
): CampaignInsight[] {
    return [...campaigns]
        .sort((a, b) => b.roas - a.roas)
        .slice(0, count)
        .map((c) => toInsight(c, c.roas));
}

/** Top N campaigns by spend (descending). */
export function getTopCampaignsBySpend(
    campaigns: CampaignAggregate[],
    count = 5
): CampaignInsight[] {
    return [...campaigns]
        .sort((a, b) => b.spend - a.spend)
        .slice(0, count)
        .map((c) => toInsight(c, c.spend));
}

/** Worst N campaigns by ROAS (ascending), excluding zero-spend campaigns. */
export function getWorstCampaigns(
    campaigns: CampaignAggregate[],
    count = 5
): CampaignInsight[] {
    return [...campaigns]
        .filter((c) => c.spend > 0)
        .sort((a, b) => a.roas - b.roas)
        .slice(0, count)
        .map((c) => toInsight(c, c.roas));
}
