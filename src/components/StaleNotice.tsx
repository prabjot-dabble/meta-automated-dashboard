import { AlertTriangle } from "lucide-react";

/**
 * Reads the `x-cache-at` timestamp the API sets on stale responses (Meta
 * failed, last good data served). Returns null for fresh/cached-hit responses.
 */
export function staleSince(res: Response): number | null {
    if (res.headers.get("x-cache") !== "stale") return null;
    const at = Number(res.headers.get("x-cache-at"));
    return Number.isFinite(at) && at > 0 ? at : Date.now();
}

/** "2 hours ago" / "5 min ago" / "just now" for an epoch-ms timestamp. */
function ago(at: number): string {
    const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

interface StaleNoticeProps {
    /** Epoch ms of the data being shown; renders nothing when null. */
    since: number | null;
    onRetry?: () => void;
}

/** Banner shown when the dashboard is displaying older data because Meta failed. */
export default function StaleNotice({ since, onRetry }: StaleNoticeProps) {
    if (since === null) return null;

    return (
        <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-[10px] border border-hairline bg-surface-2 px-4 py-3 text-sm text-ink-secondary"
        >
            <AlertTriangle size={16} className="shrink-0 text-warning" />
            <span className="flex-1">
                Meta isn&apos;t responding right now, so these numbers are from{" "}
                <strong className="font-semibold text-ink">{ago(since)}</strong>
                . They may be slightly out of date.
            </span>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-[10px] border border-hairline px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-hairline-strong"
                >
                    Try again
                </button>
            )}
        </div>
    );
}
