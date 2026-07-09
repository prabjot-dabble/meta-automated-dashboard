"use client";

import { useMemo } from "react";
import { MetaCampaign } from "@/types/meta";
import { buildAccountTrace, buildCampaignTrace } from "@/lib/debug";

type Props = {
    data: MetaCampaign[];
};

/**
 * Developer-only traceability panel (gated by `?debug=1` in page.tsx).
 *
 * Shows the Raw → Parsed → Calculated → Displayed chain for account totals and
 * every campaign, so numbers can be reconciled against Meta Ads Manager and
 * spreadsheets. Not part of the executive view.
 */
export default function DebugPanel({ data }: Props) {
    const accountTrace = useMemo(() => buildAccountTrace(data), [data]);
    const campaignTrace = useMemo(() => buildCampaignTrace(data), [data]);

    return (
        <section className="mt-10 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-6">
            <div className="mb-4 flex items-center gap-2">
                <span className="rounded-md bg-amber-500 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                    Debug
                </span>
                <h2 className="text-lg font-bold text-amber-900">
                    Metric Traceability ({data.length} raw campaign-day rows)
                </h2>
            </div>

            <p className="mb-3 text-sm font-semibold text-amber-800">
                Account totals
            </p>
            <div className="mb-8 overflow-auto rounded-lg border border-amber-200 bg-white">
                <table className="w-full text-left text-sm">
                    <thead className="bg-amber-100 text-amber-900">
                        <tr>
                            <th className="px-4 py-2 font-semibold">Metric</th>
                            <th className="px-4 py-2 font-semibold">Raw</th>
                            <th className="px-4 py-2 font-semibold">Parsed</th>
                            <th className="px-4 py-2 font-semibold">Calculated</th>
                            <th className="px-4 py-2 font-semibold">Displayed</th>
                        </tr>
                    </thead>
                    <tbody className="font-mono text-xs text-gray-700">
                        {accountTrace.map((t) => (
                            <tr key={t.metric} className="border-t border-amber-100">
                                <td className="px-4 py-2 font-sans font-medium text-gray-900">
                                    {t.metric}
                                </td>
                                <td className="px-4 py-2">{t.raw}</td>
                                <td className="px-4 py-2">{t.parsed}</td>
                                <td className="px-4 py-2">{t.calculated}</td>
                                <td className="px-4 py-2 font-sans font-semibold text-gray-900">
                                    {t.displayed}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="mb-3 text-sm font-semibold text-amber-800">
                Per-campaign aggregation
            </p>
            <div className="overflow-auto rounded-lg border border-amber-200 bg-white">
                <table className="w-full text-left text-sm">
                    <thead className="bg-amber-100 text-amber-900">
                        <tr>
                            <th className="px-4 py-2 font-semibold">Campaign</th>
                            <th className="px-4 py-2 font-semibold">ID</th>
                            <th className="px-4 py-2 font-semibold">Days</th>
                            <th className="px-4 py-2 font-semibold">Spend</th>
                            <th className="px-4 py-2 font-semibold">Revenue</th>
                            <th className="px-4 py-2 font-semibold">Purchases</th>
                            <th className="px-4 py-2 font-semibold">ROAS</th>
                        </tr>
                    </thead>
                    <tbody className="text-xs text-gray-700">
                        {campaignTrace.map((c) => (
                            <tr
                                key={c.campaign_id}
                                className="border-t border-amber-100"
                            >
                                <td className="px-4 py-2 font-medium text-gray-900">
                                    {c.campaign_name}
                                </td>
                                <td className="px-4 py-2 font-mono">
                                    {c.campaign_id}
                                </td>
                                <td className="px-4 py-2">{c.days}</td>
                                <td className="px-4 py-2">{c.displayedSpend}</td>
                                <td className="px-4 py-2">{c.displayedRevenue}</td>
                                <td className="px-4 py-2">{c.purchases}</td>
                                <td className="px-4 py-2 font-semibold text-gray-900">
                                    {c.displayedRoas}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
