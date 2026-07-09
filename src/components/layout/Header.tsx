"use client";

import { Search, RefreshCw, ChevronDown, CalendarDays, Zap } from "lucide-react";

export const DATE_PRESETS = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "last_7d", label: "Last 7 Days" },
    { value: "last_30d", label: "Last 30 Days" },
    { value: "this_month", label: "This Month" },
    { value: "last_month", label: "Last Month" },
    { value: "custom", label: "Custom Range" },
] as const;

type Props = {
    datePreset: string;
    onDatePresetChange: (value: string) => void;
    customSince: string;
    customUntil: string;
    onCustomSinceChange: (value: string) => void;
    onCustomUntilChange: (value: string) => void;
    search: string;
    onSearchChange: (value: string) => void;
    onRefresh: () => void;
    refreshing?: boolean;
    lastUpdated?: string | null;
    /** When set, replaces the date controls with a static source label. */
    sourceLabel?: string;
    /** "Active" = spent money in the selected range, see filterActiveCampaigns(). */
    activeOnly: boolean;
    onActiveOnlyChange: (value: boolean) => void;
    /** Count of campaigns with spend > 0 in the current range, for the toggle label. */
    activeCampaignCount: number;
};

export default function Header({
    datePreset,
    onDatePresetChange,
    customSince,
    customUntil,
    onCustomSinceChange,
    onCustomUntilChange,
    search,
    onSearchChange,
    onRefresh,
    refreshing = false,
    lastUpdated,
    sourceLabel,
    activeOnly,
    onActiveOnlyChange,
    activeCampaignCount,
}: Props) {
    const isCustom = datePreset === "custom";
    const presetLabel =
        isCustom && customSince && customUntil
            ? `${customSince} – ${customUntil}`
            : (DATE_PRESETS.find((p) => p.value === datePreset)?.label ??
              "Custom");
    const subtitle =
        sourceLabel ??
        `${presetLabel}${lastUpdated ? ` · updated ${lastUpdated}` : ""}`;

    return (
        <header className="glass sticky top-0 z-30 border-b border-hairline">
            <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-8">
                {/* Title */}
                <div>
                    <h1 className="text-xl font-semibold tracking-tight text-ink">
                        Overview
                    </h1>
                    <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2.5">
                    {/* Active-only toggle */}
                    <button
                        type="button"
                        onClick={() => onActiveOnlyChange(!activeOnly)}
                        aria-pressed={activeOnly}
                        title="Active = spent money in the selected date range"
                        className={`flex h-10 items-center gap-1.5 rounded-[10px] border px-3 text-sm font-medium transition-colors ${
                            activeOnly
                                ? "border-accent/40 bg-accent-soft text-accent-ink"
                                : "border-hairline bg-surface text-ink-secondary hover:border-hairline-strong hover:text-ink"
                        }`}
                    >
                        <Zap
                            size={14}
                            className={activeOnly ? "fill-current" : ""}
                        />
                        Active
                        <span
                            className={`tnum rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                                activeOnly
                                    ? "bg-accent/20"
                                    : "bg-surface-2 text-ink-muted"
                            }`}
                        >
                            {activeCampaignCount}
                        </span>
                    </button>

                    {/* Search */}
                    <div className="relative">
                        <Search
                            size={15}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder="Search campaigns…"
                            className="h-10 w-44 rounded-[10px] border border-hairline bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 md:w-56"
                        />
                    </div>

                    {/* Date preset */}
                    {!sourceLabel && (
                        <div className="relative">
                            <CalendarDays
                                size={15}
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                            />
                            <select
                                value={datePreset}
                                onChange={(e) =>
                                    onDatePresetChange(e.target.value)
                                }
                                className="h-10 cursor-pointer appearance-none rounded-[10px] border border-hairline bg-surface pl-9 pr-9 text-sm font-medium text-ink transition-colors hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                            >
                                {DATE_PRESETS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown
                                size={15}
                                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted"
                            />
                        </div>
                    )}

                    {/* Custom range inputs */}
                    {!sourceLabel && isCustom && (
                        <div className="flex items-center gap-1.5">
                            <input
                                type="date"
                                value={customSince}
                                max={customUntil || undefined}
                                onChange={(e) =>
                                    onCustomSinceChange(e.target.value)
                                }
                                aria-label="Start date"
                                className="h-10 rounded-[10px] border border-hairline bg-surface px-2.5 text-sm text-ink transition-colors hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                            />
                            <span className="text-ink-muted">–</span>
                            <input
                                type="date"
                                value={customUntil}
                                min={customSince || undefined}
                                onChange={(e) =>
                                    onCustomUntilChange(e.target.value)
                                }
                                aria-label="End date"
                                className="h-10 rounded-[10px] border border-hairline bg-surface px-2.5 text-sm text-ink transition-colors hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                            />
                        </div>
                    )}

                    {/* Refresh */}
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing}
                        aria-label="Refresh data"
                        className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-hairline bg-surface text-ink-secondary transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-60"
                    >
                        <RefreshCw
                            size={16}
                            className={refreshing ? "animate-spin" : ""}
                        />
                    </button>
                </div>
            </div>
        </header>
    );
}
