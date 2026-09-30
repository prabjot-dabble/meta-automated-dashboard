/**
 * creativeTypes.ts — Inhouse vs Parent creative classification.
 *
 * ✏️  THIS FILE IS MEANT TO BE EDITED BY HAND.
 *
 * The weekly media-type breakdown splits every ad into "Parent" (creative made
 * by a parent creator / UGC) or "Inhouse" (made by the Dabble team). Meta has
 * no field for this — it lives in your ad NAMES — so the rule is:
 *
 *   An ad whose name contains ANY keyword below (case-insensitive substring)
 *   is classified as PARENT. Every other ad is INHOUSE.
 *
 * To reclassify, just add/remove a keyword string and save — no other code
 * changes needed. Keep keywords lowercase. Prefer specific spellings that
 * appear only in creative names, not audience names (e.g. use "sustainmom",
 * which matches the DP_Vid_SustainMom creative, NOT "sustain mom", which also
 * appears in audience descriptions like "sustain mom aud").
 */

export const PARENT_CREATIVE_KEYWORDS: string[] = [
    // Named parent creators seen in ad names
    "divya",
    "khushboo",
    "pooja",
    "drishti",
    "hridu",
    "priya goel",
    "priyagoel",
    "karen",

    // Creator handles / video titles (UGC)
    "sustainmom", // DP_Vid_SustainMom_… (deliberately NOT "sustain mom" — that's an audience)
    "mom.ai",
    "maaisland",
    "miniversee",
    "i left her",
    "ilefther",
];

export type CreativeType = "inhouse" | "parent";

/** Classifies an ad by its name: any parent keyword → "parent", else "inhouse". */
export function classifyCreative(adName: string | undefined): CreativeType {
    const name = (adName ?? "").toLowerCase();
    return PARENT_CREATIVE_KEYWORDS.some((k) => name.includes(k))
        ? "parent"
        : "inhouse";
}
