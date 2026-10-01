import { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/** Change vs the previous period. `pct` is null when there's nothing to compare. */
export type KpiDelta = {
    pct: number | null;
    /** Which direction is good news: "up" (revenue), "down" (cost), or neutral. */
    good: "up" | "down" | "neutral";
    /** Shown after the percentage, e.g. "vs prev 30d". */
    label: string;
};

/** Percentage change from `previous` to `current`; null if previous is 0/absent. */
export function pctChange(current: number, previous: number | undefined): number | null {
    if (previous === undefined || !Number.isFinite(previous) || previous === 0) {
        return null;
    }
    return ((current - previous) / Math.abs(previous)) * 100;
}

type Props = {
    title: string;
    value: string;
    icon?: ReactNode;
    /** CSS color for the icon chip / accent (e.g. "var(--series-1)"). */
    accent?: string;
    /** Optional secondary line under the value (e.g. a derived figure). */
    hint?: string;
    /** Emphasize this card (e.g. the headline KPI). */
    featured?: boolean;
    /** Change vs the previous period (omit while it loads / when unavailable). */
    delta?: KpiDelta;
};

export default function KPICard({
    title,
    value,
    icon,
    accent = "var(--accent)",
    hint,
    featured = false,
    delta,
}: Props) {
    return (
        <div
            className={`group relative overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-surface p-5 transition-all duration-300 hover:border-hairline-strong hover:-translate-y-0.5 ${
                featured ? "ring-1 ring-inset" : ""
            }`}
            style={
                featured
                    ? ({ boxShadow: "var(--shadow-card)", "--tw-ring-color": accent } as React.CSSProperties)
                    : undefined
            }
        >
            {/* Accent glow, top-right */}
            <div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
                style={{ background: accent }}
            />

            <div className="relative flex items-start justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                    {title}
                </p>
                {icon && (
                    <div
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
                        style={{
                            background: `color-mix(in srgb, ${accent} 16%, transparent)`,
                            color: accent,
                        }}
                    >
                        {icon}
                    </div>
                )}
            </div>

            <div className="relative mt-3">
                <h2 className="tnum text-[1.7rem] font-semibold leading-none text-ink">
                    {value}
                </h2>
                {delta && delta.pct !== null && (
                    <DeltaChip delta={delta} pct={delta.pct} />
                )}
                {hint && (
                    <p className="mt-2 text-xs text-ink-secondary">{hint}</p>
                )}
            </div>
        </div>
    );
}

function DeltaChip({ delta, pct }: { delta: KpiDelta; pct: number }) {
    const flat = Math.abs(pct) < 0.05;
    const up = pct > 0;
    const good =
        delta.good === "neutral" || flat
            ? null
            : (delta.good === "up") === up;
    const color =
        good === null
            ? "var(--ink-muted)"
            : good
              ? "var(--positive)"
              : "var(--negative)";
    const Icon = up ? ArrowUpRight : ArrowDownRight;

    return (
        <p
            className="mt-2 flex items-center gap-1 text-xs font-medium"
            style={{ color }}
        >
            {!flat && <Icon size={13} />}
            <span className="tnum">
                {flat ? "0.0%" : `${up ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`}
            </span>
            <span className="font-normal text-ink-muted">{delta.label}</span>
        </p>
    );
}
