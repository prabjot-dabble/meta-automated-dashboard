import { ReactNode } from "react";

type Props = {
    title: string;
    subtitle?: string;
    /** Optional right-aligned slot (legend, toggle, etc.). */
    action?: ReactNode;
    children: ReactNode;
    className?: string;
};

/** Themed surface for a chart, matching the KPI cards. */
export default function ChartCard({
    title,
    subtitle,
    action,
    children,
    className = "",
}: Props) {
    return (
        <div
            className={`rounded-[var(--radius-card)] border border-hairline bg-surface p-5 ${className}`}
        >
            <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-base font-semibold text-ink">{title}</h3>
                    {subtitle && (
                        <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
                    )}
                </div>
                {action}
            </div>
            {children}
        </div>
    );
}
