"use client";

import { useEffect, useState } from "react";

/**
 * Resolves design-token colors from CSS custom properties so Recharts (which
 * needs concrete color strings, not `var(...)`) stays in sync with the theme.
 * Re-reads when the `data-theme` attribute changes.
 */
export interface ChartTheme {
    series1: string; // spend  (blue)
    series2: string; // revenue (aqua)
    series3: string; // roas   (violet)
    grid: string;
    axis: string;
    ink: string;
    inkMuted: string;
    surface: string;
    positive: string;
    negative: string;
    /** Ordinal funnel ramp, light→dark, one hue, validated CVD-safe. */
    funnel: string[];
}

const FALLBACK: ChartTheme = {
    series1: "#3987e5",
    series2: "#199e70",
    series3: "#9085e9",
    grid: "rgba(255,255,255,0.08)",
    axis: "#63718a",
    ink: "#f1f5f9",
    inkMuted: "#63718a",
    surface: "#111726",
    positive: "#10b981",
    negative: "#f43f5e",
    funnel: [
        "#cde2fb",
        "#9ec5f4",
        "#6da7ec",
        "#3987e5",
        "#256abf",
        "#184f95",
    ],
};

function read(): ChartTheme {
    if (typeof window === "undefined") return FALLBACK;
    const s = getComputedStyle(document.documentElement);
    const v = (name: string, fb: string) =>
        s.getPropertyValue(name).trim() || fb;
    return {
        series1: v("--series-1", FALLBACK.series1),
        series2: v("--series-2", FALLBACK.series2),
        series3: v("--series-3", FALLBACK.series3),
        grid: v("--hairline", FALLBACK.grid),
        axis: v("--ink-muted", FALLBACK.axis),
        ink: v("--ink", FALLBACK.ink),
        inkMuted: v("--ink-muted", FALLBACK.inkMuted),
        surface: v("--surface", FALLBACK.surface),
        positive: v("--positive", FALLBACK.positive),
        negative: v("--negative", FALLBACK.negative),
        funnel: [1, 2, 3, 4, 5, 6].map((i) =>
            v(`--funnel-${i}`, FALLBACK.funnel[i - 1])
        ),
    };
}

export function useChartTheme(): ChartTheme {
    // Lazy initializer reads the resolved tokens on first client render, so no
    // synchronous setState in the effect is needed.
    const [theme, setTheme] = useState<ChartTheme>(read);

    useEffect(() => {
        // Re-read only when the theme attribute actually changes (async callback).
        const observer = new MutationObserver(() => setTheme(read()));
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
        return () => observer.disconnect();
    }, []);

    return theme;
}
