/**
 * mockData.ts — realistic sample dataset for local UI development.
 *
 * Mirrors the real Meta Graph API shape (campaign-day rows, string numerics,
 * overlapping purchase action types) so the dashboard renders identically to
 * production. Dev-only: activated with `?mock=1`. Never used unless that flag
 * is present.
 */

import { MetaAction, MetaCampaign } from "@/types/meta";

const CAMPAIGNS = [
    { id: "23851000000100001", name: "Dessert Party Playdough Set — Winning Aud", roas: 2.6, spend: 820 },
    { id: "23851000000100002", name: "Rainbow Sensory Kit — Broad Prospecting", roas: 1.4, spend: 1350 },
    { id: "23851000000100003", name: "Unicorn Dough Jar — Retargeting 7D", roas: 4.1, spend: 460 },
    { id: "23851000000100004", name: "Dino World Play Mat — Lookalike 3%", roas: 0.9, spend: 1120 },
    { id: "23851000000100005", name: "Mini Baker Bundle — Interest Stack", roas: 2.1, spend: 640 },
    { id: "23851000000100006", name: "Glitter Slime Refill — Advantage+ Shopping", roas: 3.2, spend: 990 },
] as const;

/** Deterministic pseudo-random in [0,1) so the fixture is stable across renders. */
function rng(seed: number): number {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
}

function ymd(daysAgo: number): string {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
}

function purchaseActions(count: number, value: number): {
    actions: MetaAction[];
    action_values: MetaAction[];
    purchase_roas: MetaAction[];
    spend: number;
} {
    return {
        actions: [
            { action_type: "omni_purchase", value: String(count) },
            { action_type: "purchase", value: String(count) },
            { action_type: "offsite_conversion.fb_pixel_purchase", value: String(count) },
        ],
        action_values: [
            { action_type: "omni_purchase", value: value.toFixed(2) },
            { action_type: "purchase", value: value.toFixed(2) },
            { action_type: "offsite_conversion.fb_pixel_purchase", value: value.toFixed(2) },
        ],
        purchase_roas: [],
        spend: 0,
    };
}

const DAYS = 14;

export const MOCK_CAMPAIGNS: MetaCampaign[] = CAMPAIGNS.flatMap((c, ci) =>
    Array.from({ length: DAYS }).map((_, di): MetaCampaign => {
        const seed = ci * 100 + di + 1;
        const noise = 0.7 + rng(seed) * 0.6; // 0.7–1.3

        const spend = +(c.spend * noise).toFixed(2);
        const roas = Math.max(0.2, c.roas * (0.75 + rng(seed + 7) * 0.5));
        const revenue = +(spend * roas).toFixed(2);
        const purchases = Math.max(0, Math.round((revenue / 950) * (0.8 + rng(seed + 3) * 0.4)));
        const clicks = Math.round(spend / (2.2 + rng(seed + 5)));
        const impressions = Math.round(clicks / (0.028 + rng(seed + 9) * 0.02));
        const reach = Math.round(impressions * (0.6 + rng(seed + 11) * 0.2));

        // Funnel mid-stages, roughly monotone-decreasing shares of clicks.
        const landingViews = Math.round(clicks * (0.75 + rng(seed + 13) * 0.15));
        const addToCart = Math.round(landingViews * (0.35 + rng(seed + 17) * 0.15));
        const checkout = Math.round(addToCart * (0.45 + rng(seed + 19) * 0.15));

        const pa = purchaseActions(purchases, revenue);
        pa.actions.push(
            { action_type: "landing_page_view", value: String(landingViews) },
            { action_type: "omni_add_to_cart", value: String(addToCart) },
            { action_type: "omni_initiated_checkout", value: String(checkout) }
        );

        return {
            campaign_name: c.name,
            campaign_id: c.id,
            spend: spend.toFixed(2),
            impressions: String(impressions),
            reach: String(reach),
            clicks: String(clicks),
            cpc: (spend / Math.max(1, clicks)).toFixed(2),
            cpm: ((spend / Math.max(1, impressions)) * 1000).toFixed(2),
            ctr: ((clicks / Math.max(1, impressions)) * 100).toFixed(4),
            actions: pa.actions,
            action_values: pa.action_values,
            purchase_roas: [{ action_type: "omni_purchase", value: roas.toFixed(4) }],
            cost_per_action_type: [
                {
                    action_type: "omni_purchase",
                    value: (spend / Math.max(1, purchases)).toFixed(2),
                },
            ],
            date_start: ymd(DAYS - di),
            date_stop: ymd(DAYS - di),
        };
    })
);
