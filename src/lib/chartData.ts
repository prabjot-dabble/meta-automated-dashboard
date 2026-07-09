/**
 * chartData.ts — compatibility shim.
 *
 * Daily aggregation now lives in `@/lib/metrics` (`getDailySeries`). This
 * re-export preserves the existing `getDailyChartData` import used by the
 * dashboard while routing through the single source of truth.
 */

export { getDailySeries as getDailyChartData } from "@/lib/metrics";
export type { DailyMetricPoint } from "@/lib/metrics";
