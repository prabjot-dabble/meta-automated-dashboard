/**
 * adSearch.ts — forgiving text search for the Creative Insights table.
 *
 * Ad names look like `DP_Vid_AD1_Fingerpaint_04Aug2026` or
 * `Finger paint - I left her - 24 Jun`, and nobody remembers where the
 * underscores go. So matching ignores case and treats every separator
 * (underscore, dot, hyphen, slash, space, apostrophe, ...) as the same thing.
 *
 * A query is split into words. Every word must be found in the ad, either:
 *  - inside the separator-normalised text   ("finger" in "dp vid ad1 fingerpaint")
 *  - or inside the text with ALL separators removed, which is what lets
 *    "fingerpaint" find "Finger Paint" and "price drop" find "PriceDrop".
 * Words can be typed in any order, and partial words match ("navr" -> Navratri).
 */

/** Characters that count as "a separator" between words. */
const NOT_ALNUM = /[^a-z0-9À-￿]+/g;
/** Typographic dashes, arrows etc. (U+2000-206F, U+2190-21FF) behave like spaces. */
const FANCY_PUNCTUATION = /[ -⁯←-⇿]/g;
const APOSTROPHES = /['’`"]/g;
const COMBINING_MARKS = /[̀-ͯ]/g;

export interface Searchable {
    /** Lowercase, accents and apostrophes dropped, separators turned into single spaces. */
    text: string;
    /** `text` with the spaces removed too. */
    compact: string;
}

/** Lowercases and flattens any run of separators into one space. */
export function normalizeForSearch(input: string): string {
    return input
        .toLowerCase()
        .normalize("NFKD")
        .replace(COMBINING_MARKS, "")
        .replace(APOSTROPHES, "") // "It's" -> "its", so "its" finds it
        .replace(FANCY_PUNCTUATION, " ")
        .replace(NOT_ALNUM, " ")
        .trim();
}

/** Precomputes the searchable forms of an ad (do this once per row, not per keystroke). */
export function toSearchable(...parts: (string | undefined)[]): Searchable {
    const text = normalizeForSearch(parts.filter(Boolean).join(" "));
    return { text, compact: text.replace(/ /g, "") };
}

/** Splits what the user typed into the words that must all match. */
export function parseSearchQuery(query: string): string[] {
    return normalizeForSearch(query).split(" ").filter(Boolean);
}

/** True when every word in `tokens` is found in the ad. No words = matches everything. */
export function matchesSearch(item: Searchable, tokens: string[]): boolean {
    return tokens.every(
        (token) => item.text.includes(token) || item.compact.includes(token)
    );
}
