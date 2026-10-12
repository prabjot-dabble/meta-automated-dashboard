/**
 * metaGraph.ts — server-side helpers shared by the Meta API routes.
 *
 * Owns the low-level Graph concerns (retry policy, pagination, local-date
 * formatting) so every route queries Meta the same way. Route files keep only
 * their query construction and caching.
 */

import { MetaCampaign, MetaInsightsPage } from "@/types/meta";

export const GRAPH_VERSION = "v25.0";

/**
 * Formats a Date as a local `YYYY-MM-DD` string.
 *
 * We deliberately avoid `toISOString()` here: it converts to UTC, which for
 * IST (UTC+5:30) rolls local midnight back to the previous calendar day and
 * produced off-by-one month boundaries for `this_month` / `last_month`.
 */
export function toLocalYMD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/* ── Date-range resolution (shared by every route) ─────────────────────── */

export const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds the date portion of the Graph query.
 *
 * Precedence: an explicit custom range (`since`/`until`, both YYYY-MM-DD) wins;
 * otherwise `this_month`/`last_month` are expanded to a local time_range (to
 * dodge the UTC boundary bug); every other preset passes through as
 * `date_preset`.
 */
export function buildDateQuery(
    datePreset: string,
    since: string | null,
    until: string | null
): string {
    if (since && until && YMD.test(since) && YMD.test(until)) {
        return `time_range={"since":"${since}","until":"${until}"}`;
    }

    const today = new Date();

    if (datePreset === "this_month") {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return `time_range={"since":"${toLocalYMD(firstDay)}","until":"${toLocalYMD(lastDay)}"}`;
    }

    if (datePreset === "last_month") {
        const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
        return `time_range={"since":"${toLocalYMD(firstDay)}","until":"${toLocalYMD(lastDay)}"}`;
    }

    return `date_preset=${encodeURIComponent(datePreset)}`;
}

/** Parses a local YYYY-MM-DD (never `new Date("YYYY-MM-DD")`, which is UTC). */
export function parseLocalYMD(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
}

/**
 * Resolves the request to a concrete local {since, until}, or null when it
 * can't be expressed as dates (the caller then falls back to one plain call).
 * `last_Nd` follows Meta's definition: N full days ending yesterday.
 */
export function resolveRange(
    datePreset: string,
    since: string | null,
    until: string | null
): { since: Date; until: Date } | null {
    if (since && until && YMD.test(since) && YMD.test(until)) {
        return { since: parseLocalYMD(since), until: parseLocalYMD(until) };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysAgo = (n: number) =>
        new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);

    if (datePreset === "today") return { since: today, until: today };
    if (datePreset === "yesterday") return { since: daysAgo(1), until: daysAgo(1) };
    if (datePreset === "this_month") {
        return {
            since: new Date(today.getFullYear(), today.getMonth(), 1),
            until: new Date(today.getFullYear(), today.getMonth() + 1, 0),
        };
    }
    if (datePreset === "last_month") {
        return {
            since: new Date(today.getFullYear(), today.getMonth() - 1, 1),
            until: new Date(today.getFullYear(), today.getMonth(), 0),
        };
    }
    const m = /^last_(\d+)d$/.exec(datePreset);
    if (m) return { since: daysAgo(Number(m[1])), until: daysAgo(1) };

    return null;
}

/**
 * The period of the same length immediately before `range` (for "vs previous"
 * deltas). A range that extends past today (e.g. this_month) is measured up to
 * today, so a partial month compares against the same number of days before it.
 * Returns null for a single still-running day ("today"): a partial day against a
 * full one is misleading.
 */
export function previousRange(range: {
    since: Date;
    until: Date;
}): { since: Date; until: Date } | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const until = range.until > today ? today : range.until;
    const days =
        Math.round((until.getTime() - range.since.getTime()) / 86_400_000) + 1;
    if (days < 1) return null;
    if (days === 1 && until.getTime() === today.getTime()) return null;

    const prevUntil = new Date(
        range.since.getFullYear(),
        range.since.getMonth(),
        range.since.getDate() - 1
    );
    const prevSince = new Date(
        prevUntil.getFullYear(),
        prevUntil.getMonth(),
        prevUntil.getDate() - (days - 1)
    );
    return { since: prevSince, until: prevUntil };
}

const ACTION_ARRAY_KEYS = ["actions", "action_values", "purchase_roas"] as const;

/**
 * Drops every action type not in `allowed` from each row's action arrays
 * (in place — no extra copies of large result sets). Rows keep the same shape;
 * arrays just get shorter. Returns the same array for chaining.
 */
export function trimActionTypes<T extends MetaCampaign>(
    rows: T[],
    allowed: readonly string[]
): T[] {
    const keep = new Set(allowed);
    for (const row of rows) {
        for (const key of ACTION_ARRAY_KEYS) {
            const arr = row[key];
            if (Array.isArray(arr)) {
                row[key] = arr.filter((a) => keep.has(a.action_type));
            }
        }
    }
    return rows;
}

/**
 * Cache lifetime for a query whose range ends on `until` (local date).
 *
 * - Includes today (or later): numbers move all day → 5 min.
 * - Ended within the last 7 days: Meta keeps attributing conversions to those
 *   days (attribution windows), so they can still shift → 30 min.
 * - Older: effectively final → 24 h.
 */
export function cacheTtlMs(until: Date): number {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysAgo = Math.round((today.getTime() - until.getTime()) / 86_400_000);

    if (daysAgo < 0 || daysAgo === 0) return 5 * 60 * 1000;
    if (daysAgo <= 7) return 30 * 60 * 1000;
    return 24 * 60 * 60 * 1000;
}

/**
 * Meta transient error codes worth retrying. `code 1` / `error_subcode 99`
 * ("An unknown error occurred") and `code 2` are intermittent server-side
 * failures that Graph itself recommends retrying — they hit the default
 * `last_30d` view often enough to matter.
 */
function isTransientMetaError(error: { code?: number } | undefined): boolean {
    return error?.code === 1 || error?.code === 2;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;
// A hung Graph call should fail fast and be retried, not stall for minutes.
const REQUEST_TIMEOUT_MS = 25_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Carries a Meta error body so route handlers can return it verbatim. */
export class MetaRequestError extends Error {
    constructor(
        message: string,
        public readonly metaError?: MetaInsightsPage["error"]
    ) {
        super(message);
        this.name = "MetaRequestError";
    }
}

/**
 * Fetches and parses one Graph page, retrying transient failures (network
 * errors, non-JSON, transient Meta error codes) with linear backoff. Returns
 * the parsed page, or throws with a caller-friendly message on final failure.
 */
export async function fetchPageWithRetry(
    pageUrl: string
): Promise<MetaInsightsPage> {
    let lastError = "Meta API request failed.";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(pageUrl, {
                cache: "no-store",
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            const json = (await response.json()) as MetaInsightsPage;

            if (json.error) {
                if (isTransientMetaError(json.error) && attempt < MAX_ATTEMPTS) {
                    lastError = json.error.message;
                    await sleep(RETRY_BASE_MS * attempt);
                    continue;
                }
                // Non-transient (or out of attempts): surface Meta's error.
                throw new MetaRequestError(json.error.message, json.error);
            }

            return json;
        } catch (err) {
            if (err instanceof MetaRequestError) throw err;
            // Network / non-JSON failure — retry if attempts remain.
            lastError =
                err instanceof Error ? err.message : "Unknown network error.";
            if (attempt < MAX_ATTEMPTS) {
                await sleep(RETRY_BASE_MS * attempt);
                continue;
            }
        }
    }

    throw new MetaRequestError(lastError);
}

/**
 * Follows Graph cursor pagination from `firstUrl` and returns all rows.
 * `T` narrows the row shape for callers that request extra fields
 * (e.g. ad-level rows with `ad_name`).
 */
export async function fetchAllPages<T extends MetaCampaign>(
    firstUrl: string
): Promise<T[]> {
    const rows: T[] = [];
    let nextUrl: string | null = firstUrl;

    while (nextUrl) {
        const json = await fetchPageWithRetry(nextUrl);
        if (Array.isArray(json.data)) rows.push(...(json.data as T[]));
        nextUrl = json.paging?.next ?? null;
    }

    return rows;
}
