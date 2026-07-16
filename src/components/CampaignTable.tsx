"use client";

import { useMemo, useState } from "react";
import {
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    getPaginationRowModel,
    SortingState,
    VisibilityState,
    useReactTable,
} from "@tanstack/react-table";
import {
    ChevronUp,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    SlidersHorizontal,
    Download,
    Check,
} from "lucide-react";

import { columns, DEFAULT_HIDDEN_COLUMNS } from "@/lib/columns";
import {
    CampaignAggregate,
    formatCurrency,
    formatNumber,
    formatPercent,
    formatRoas,
    sumAggregates,
} from "@/lib/metrics";
import { exportCampaignsCsv } from "@/lib/csv";

type Props = {
    campaigns: CampaignAggregate[];
};

const PAGE_SIZE = 10;

export default function CampaignTable({ campaigns }: Props) {
    const [sorting, setSorting] = useState<SortingState>([
        { id: "spend", desc: true },
    ]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
        DEFAULT_HIDDEN_COLUMNS
    );
    const [menuOpen, setMenuOpen] = useState(false);

    const table = useReactTable({
        data: campaigns,
        columns,
        state: { sorting, columnVisibility },
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: { pagination: { pageSize: PAGE_SIZE } },
    });

    // Totals row reflects the full (searched) set, not just the current page.
    const filtered = table
        .getFilteredRowModel()
        .rows.map((r) => r.original);
    const totals = useMemo(() => sumAggregates(filtered), [filtered]);

    const visibleColumns = table.getVisibleLeafColumns();
    const pageIndex = table.getState().pagination.pageIndex;
    const pageCount = table.getPageCount();

    function footerCell(colId: string) {
        switch (colId) {
            case "campaign_name":
                return `Totals · ${totals.campaignCount} campaigns`;
            case "spend":
                return formatCurrency(totals.spend);
            case "revenue":
                return formatCurrency(totals.revenue);
            case "roas":
                return `${formatRoas(totals.roas)}×`;
            case "purchases":
                return formatNumber(totals.purchases);
            case "costPerPurchase":
                return formatCurrency(totals.costPerPurchase);
            case "impressions":
                return formatNumber(totals.impressions);
            case "clicks":
                return formatNumber(totals.clicks);
            case "landingViews":
                return formatNumber(totals.landingViews);
            case "addToCart":
                return formatNumber(totals.addToCart);
            case "checkoutInitiated":
                return formatNumber(totals.checkoutInitiated);
            case "ctr":
                return formatPercent(totals.ctr);
            case "clicksToLpv":
                return formatPercent(totals.clicksToLpv);
            case "cpc":
                return formatCurrency(totals.cpc);
            case "cpm":
                return formatCurrency(totals.cpm);
            default:
                return "";
        }
    }

    return (
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
                <div>
                    <h2 className="text-base font-semibold text-ink">Campaigns</h2>
                    <p className="mt-0.5 text-xs text-ink-muted">
                        {filtered.length} campaign
                        {filtered.length === 1 ? "" : "s"}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Column visibility */}
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setMenuOpen((o) => !o)}
                            className="flex items-center gap-2 rounded-[10px] border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:border-hairline-strong hover:text-ink"
                        >
                            <SlidersHorizontal size={15} />
                            Columns
                        </button>
                        {menuOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setMenuOpen(false)}
                                />
                                <div className="absolute right-0 z-50 mt-2 w-48 rounded-[10px] border border-hairline bg-surface-2 p-1.5 shadow-xl">
                                    {table
                                        .getAllLeafColumns()
                                        .filter((c) => c.getCanHide())
                                        .map((col) => (
                                            <button
                                                key={col.id}
                                                type="button"
                                                onClick={() =>
                                                    col.toggleVisibility()
                                                }
                                                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink"
                                            >
                                                {col.columnDef.meta?.label ??
                                                    col.id}
                                                {col.getIsVisible() && (
                                                    <Check
                                                        size={14}
                                                        className="text-accent"
                                                    />
                                                )}
                                            </button>
                                        ))}
                                </div>
                            </>
                        )}
                    </div>

                    {/* CSV export */}
                    <button
                        type="button"
                        onClick={() => exportCampaignsCsv(filtered)}
                        className="flex items-center gap-2 rounded-[10px] border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:border-hairline-strong hover:text-ink"
                    >
                        <Download size={15} />
                        Export
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        {table.getHeaderGroups().map((hg) => (
                            <tr key={hg.id}>
                                {hg.headers.map((header, i) => {
                                    const align =
                                        header.column.columnDef.meta?.align ??
                                        "right";
                                    const sticky = i === 0;
                                    return (
                                        <th
                                            key={header.id}
                                            onClick={header.column.getToggleSortingHandler()}
                                            className={`select-none whitespace-nowrap border-b border-hairline bg-surface px-5 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted ${
                                                align === "right"
                                                    ? "text-right"
                                                    : "text-left"
                                            } ${
                                                header.column.getCanSort()
                                                    ? "cursor-pointer hover:text-ink-secondary"
                                                    : ""
                                            } ${
                                                sticky
                                                    ? "sticky left-0 z-20"
                                                    : ""
                                            }`}
                                        >
                                            <span
                                                className={`inline-flex items-center gap-1 ${
                                                    align === "right"
                                                        ? "flex-row-reverse"
                                                        : ""
                                                }`}
                                            >
                                                {flexRender(
                                                    header.column.columnDef
                                                        .header,
                                                    header.getContext()
                                                )}
                                                {{
                                                    asc: <ChevronUp size={13} />,
                                                    desc: (
                                                        <ChevronDown size={13} />
                                                    ),
                                                }[
                                                    header.column.getIsSorted() as string
                                                ] ?? null}
                                            </span>
                                        </th>
                                    );
                                })}
                            </tr>
                        ))}
                    </thead>

                    <tbody>
                        {table.getRowModel().rows.map((row) => (
                            <tr
                                key={row.id}
                                className="group border-b border-hairline transition-colors hover:bg-surface-2"
                            >
                                {row.getVisibleCells().map((cell, i) => {
                                    const align =
                                        cell.column.columnDef.meta?.align ??
                                        "right";
                                    const sticky = i === 0;
                                    return (
                                        <td
                                            key={cell.id}
                                            className={`tnum whitespace-nowrap px-5 py-3 text-ink-secondary ${
                                                align === "right"
                                                    ? "text-right"
                                                    : "text-left"
                                            } ${
                                                sticky
                                                    ? "sticky left-0 z-10 bg-surface group-hover:bg-surface-2"
                                                    : ""
                                            }`}
                                        >
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>

                    {/* Pinned totals */}
                    <tfoot>
                        <tr className="border-t border-hairline-strong">
                            {visibleColumns.map((col, i) => {
                                const align =
                                    col.columnDef.meta?.align ?? "right";
                                const sticky = i === 0;
                                return (
                                    <td
                                        key={col.id}
                                        className={`tnum whitespace-nowrap bg-surface-2 px-5 py-3 text-sm font-semibold text-ink ${
                                            align === "right"
                                                ? "text-right"
                                                : "text-left"
                                        } ${sticky ? "sticky left-0 z-10" : ""}`}
                                    >
                                        {footerCell(col.id)}
                                    </td>
                                );
                            })}
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Pagination */}
            {pageCount > 1 && (
                <div className="flex items-center justify-between border-t border-hairline px-5 py-3">
                    <p className="text-xs text-ink-muted">
                        Page {pageIndex + 1} of {pageCount}
                    </p>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-secondary transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-40 disabled:hover:border-hairline"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-secondary transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-40 disabled:hover:border-hairline"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
