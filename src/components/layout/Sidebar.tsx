"use client";

import {
    LayoutDashboard,
    LineChart,
    Table2,
    Sparkles,
} from "lucide-react";

const NAV = [
    { label: "Overview", href: "#overview", icon: LayoutDashboard },
    { label: "Performance", href: "#performance", icon: LineChart },
    { label: "Insights", href: "#insights", icon: Sparkles },
    { label: "Campaigns", href: "#campaigns", icon: Table2 },
] as const;

export default function Sidebar() {
    return (
        <aside className="sticky top-0 hidden h-screen w-60 flex-shrink-0 flex-col border-r border-hairline bg-plane-2 lg:flex">
            {/* Brand */}
            <div className="flex items-center gap-3 px-5 py-6">
                <div
                    className="flex h-9 w-9 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                    style={{
                        background:
                            "linear-gradient(135deg, var(--accent-2), var(--accent))",
                    }}
                >
                    D
                </div>
                <div className="leading-tight">
                    <p className="text-sm font-semibold text-ink">Dabble</p>
                    <p className="text-xs text-ink-muted">Meta Analytics</p>
                </div>
            </div>

            {/* Nav */}
            <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
                {NAV.map(({ label, href, icon: Icon }, i) => (
                    <a
                        key={href}
                        href={href}
                        className={`group flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-colors ${
                            i === 0
                                ? "bg-surface-2 text-ink"
                                : "text-ink-secondary hover:bg-surface-2 hover:text-ink"
                        }`}
                    >
                        <Icon
                            size={18}
                            className={
                                i === 0
                                    ? "text-accent"
                                    : "text-ink-muted group-hover:text-ink-secondary"
                            }
                        />
                        {label}
                    </a>
                ))}
            </nav>

            {/* Footer */}
            <div className="border-t border-hairline px-5 py-4">
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                    Meta Marketing API · v25.0
                </div>
            </div>
        </aside>
    );
}
