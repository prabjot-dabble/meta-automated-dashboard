/**
 * helpers.ts — thin compatibility layer.
 *
 * All business logic now lives in `@/lib/metrics` (the single source of truth).
 * These re-exports preserve the historical `getRevenue`/`getPurchases`/`getROAS`
 * names used across the codebase while guaranteeing every surface computes the
 * same numbers. Prefer importing from `@/lib/metrics` directly in new code.
 */

import { getRowRoas, pickCanonicalValue } from "@/lib/metrics";
import { MetaCampaign } from "@/types/meta";

export { getRevenue, getPurchases } from "@/lib/metrics";

/** Per-row ROAS as reported by Meta. See `getRowRoas` for aggregation caveats. */
export function getROAS(campaign: MetaCampaign): number {
    return getRowRoas(campaign);
}

/** Deprecated: use `pickCanonicalValue` from `@/lib/metrics`. */
export function getActionValue(
    campaign: MetaCampaign,
    actionTypes: string[]
): number {
    return pickCanonicalValue(campaign.actions, actionTypes);
}
