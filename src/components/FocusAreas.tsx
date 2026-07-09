"use client";

import { useMemo } from "react";
import { TrendingUp, ArrowRightLeft } from "lucide-react";
import { CampaignAggregate, formatCurrency, formatRoas, getFocusAreas } from "@/lib/metrics";

type Props = {
    campaigns: CampaignAggregate[];
};

function FocusRow({ c, accountRoas }: { c: CampaignAggregate; accountRoas: number }) {
    const vsAccount = accountRoas > 0 ? (c.roas / accountRoas - 1) * 100 : 0;
    return (
        <div className="flex items-center gap-3 rounded-[10px] border border-hairline bg-surface-2 px-3.5 py-3">
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                    {c.campaign_name}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                    {formatCurrency(c.spend, 0)} spent · {c.purchases} purchases
                </p>
            </div>
            <div className="flex-shrink-0 text-right">
                <p className="tnum text-base font-bold text-ink">
                    {formatRoas(c.roas)}×
                </p>
                <p
                    className={`tnum text-[11px] font-medium ${
                        vsAccount >= 0 ? "text-positive" : "text-negative"
                    }`}
                >
                    {vsAccount >= 0 ? "+" : ""}
                    {vsAccount.toFixed(0)}% vs avg
                </p>
            </div>
        </div>
    );
}

/**
 * Data-driven budget recommendations: campaigns worth scaling (efficient +
 * under-funded) vs. reallocating away from (high spend + underperforming),
 * relative to the account's own weighted ROAS. See `getFocusAreas` for the
 * exact thresholds.
 */
export default function FocusAreas({ campaigns }: Props) {
    const { scaleUp, reallocate, accountRoas, medianSpend } = useMemo(
        () => getFocusAreas(campaigns),
        [campaigns]
    );

    if (scaleUp.length === 0 && reallocate.length === 0) return null;

    return (
        <div>
            <h2 className="mb-1 text-lg font-semibold text-ink">Focus Areas</h2>
            <p className="mb-4 text-xs text-ink-muted">
                Relative to account ROAS {formatRoas(accountRoas)}× and median
                spend {formatCurrency(medianSpend, 0)}
            </p>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
                    <div className="mb-4 flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-positive/15 text-positive">
                            <TrendingUp size={16} />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-ink">
                                Scale Up
                            </h3>
                            <p className="text-xs text-ink-muted">
                                Efficient and under-funded
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2.5">
                        {scaleUp.length === 0 ? (
                            <p className="py-6 text-center text-sm text-ink-muted">
                                No clear scale-up candidates right now.
                            </p>
                        ) : (
                            scaleUp.map((c) => (
                                <FocusRow
                                    key={c.campaign_id}
                                    c={c}
                                    accountRoas={accountRoas}
                                />
                            ))
                        )}
                    </div>
                </div>

                <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
                    <div className="mb-4 flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-warning/15 text-warning">
                            <ArrowRightLeft size={16} />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-ink">
                                Reallocate
                            </h3>
                            <p className="text-xs text-ink-muted">
                                High spend, below-average return
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2.5">
                        {reallocate.length === 0 ? (
                            <p className="py-6 text-center text-sm text-ink-muted">
                                No campaigns need reallocation right now.
                            </p>
                        ) : (
                            reallocate.map((c) => (
                                <FocusRow
                                    key={c.campaign_id}
                                    c={c}
                                    accountRoas={accountRoas}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
