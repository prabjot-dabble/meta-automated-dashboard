import { CampaignAggregate } from "@/lib/metrics";

const HEADERS: { key: keyof CampaignAggregate; label: string }[] = [
    { key: "campaign_name", label: "Campaign" },
    { key: "campaign_id", label: "Campaign ID" },
    { key: "spend", label: "Cost" },
    { key: "purchases", label: "Purchases" },
    { key: "revenue", label: "Revenue" },
    { key: "roas", label: "ROAS" },
    { key: "impressions", label: "Impressions" },
    { key: "clicks", label: "Clicks" },
    { key: "landingViews", label: "Landing Page Views" },
    { key: "addToCart", label: "Add to Cart" },
    { key: "checkoutInitiated", label: "Checkout Initiated" },
    { key: "ctr", label: "CTR (%)" },
    { key: "clicksToLpv", label: "Clicks to LPV (%)" },
    { key: "costPerPurchase", label: "Cost per Purchase" },
    { key: "cpc", label: "CPC" },
    { key: "cpm", label: "CPM" },
    { key: "reach", label: "Reach (sum of daily)" },
    { key: "days", label: "Days" },
];

function escape(value: string | number): string {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds and downloads a CSV of the given campaigns (raw numeric values). */
export function exportCampaignsCsv(
    campaigns: CampaignAggregate[],
    filename = "campaigns.csv"
): void {
    const head = HEADERS.map((h) => escape(h.label)).join(",");
    const rows = campaigns.map((c) =>
        HEADERS.map((h) => {
            const v = c[h.key];
            return escape(typeof v === "number" ? Number(v.toFixed(2)) : v);
        }).join(",")
    );
    const csv = [head, ...rows].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
