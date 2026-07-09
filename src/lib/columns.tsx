"use client";

import { ColumnDef, RowData } from "@tanstack/react-table";
import {
    CampaignAggregate,
    formatCurrency,
    formatNumber,
    formatPercent,
    formatRoas,
} from "@/lib/metrics";

declare module "@tanstack/react-table" {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData extends RowData, TValue> {
        align?: "left" | "right";
        label?: string;
    }
}

/** ROAS pill coloured by performance band (≥2 good · ≥1 caution · <1 poor). */
function RoasBadge({ value }: { value: number }) {
    const tone =
        value >= 2
            ? "bg-positive/15 text-positive"
            : value >= 1
              ? "bg-warning/15 text-warning"
              : "bg-negative/15 text-negative";
    return (
        <span
            className={`tnum inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${tone}`}
        >
            {formatRoas(value)}×
        </span>
    );
}

/**
 * Table columns operate on `CampaignAggregate` (one row per campaign). Values
 * are pre-derived by `aggregateByCampaign`; cells only format. All formatting
 * goes through the shared formatters so the table reconciles with the KPIs.
 */
export const columns: ColumnDef<CampaignAggregate>[] = [
    {
        accessorKey: "campaign_name",
        header: "Campaign",
        enableSorting: true,
        enableHiding: false,
        meta: { align: "left", label: "Campaign" },
        cell: ({ getValue }) => (
            <span className="block max-w-[280px] truncate text-ink" title={getValue<string>()}>
                {getValue<string>()}
            </span>
        ),
    },
    {
        id: "spend",
        accessorFn: (row) => row.spend,
        header: "Spend",
        meta: { align: "right", label: "Spend" },
        cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
    {
        id: "revenue",
        accessorFn: (row) => row.revenue,
        header: "Revenue",
        meta: { align: "right", label: "Revenue" },
        cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
    {
        id: "roas",
        accessorFn: (row) => row.roas,
        header: "ROAS",
        meta: { align: "right", label: "ROAS" },
        cell: ({ getValue }) => <RoasBadge value={getValue<number>()} />,
    },
    {
        id: "purchases",
        accessorFn: (row) => row.purchases,
        header: "Purchases",
        meta: { align: "right", label: "Purchases" },
        cell: ({ getValue }) => formatNumber(getValue<number>()),
    },
    {
        id: "costPerPurchase",
        accessorFn: (row) => row.costPerPurchase,
        header: "Cost / Purch.",
        meta: { align: "right", label: "Cost / Purchase" },
        cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
    {
        id: "impressions",
        accessorFn: (row) => row.impressions,
        header: "Impressions",
        meta: { align: "right", label: "Impressions" },
        cell: ({ getValue }) => formatNumber(getValue<number>()),
    },
    {
        id: "clicks",
        accessorFn: (row) => row.clicks,
        header: "Clicks",
        meta: { align: "right", label: "Clicks" },
        cell: ({ getValue }) => formatNumber(getValue<number>()),
    },
    {
        id: "ctr",
        accessorFn: (row) => row.ctr,
        header: "CTR",
        meta: { align: "right", label: "CTR" },
        cell: ({ getValue }) => formatPercent(getValue<number>()),
    },
    {
        id: "cpc",
        accessorFn: (row) => row.cpc,
        header: "CPC",
        meta: { align: "right", label: "CPC" },
        cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
    {
        id: "cpm",
        accessorFn: (row) => row.cpm,
        header: "CPM",
        meta: { align: "right", label: "CPM" },
        cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
];

/** Columns hidden by default (toggleable via the column menu). */
export const DEFAULT_HIDDEN_COLUMNS: Record<string, boolean> = {
    impressions: false,
    clicks: false,
    cpc: false,
    cpm: false,
};
