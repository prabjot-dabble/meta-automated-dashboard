"use client";

import { useMemo } from "react";
import {
  CampaignAggregate,
  deriveRoas,
  formatCurrency,
  formatRoas,
} from "@/lib/metrics";
import {
  CampaignInsight,
  getTopCampaignsByROAS,
  getTopCampaignsBySpend,
  getWorstCampaigns,
} from "@/lib/campaignInsights";

/** Weighted ROAS across a set of ranked campaigns: Σrevenue / Σspend. */
function weightedRoas(items: CampaignInsight[]): number {
  const spend = items.reduce((sum, c) => sum + c.spend, 0);
  const revenue = items.reduce((sum, c) => sum + c.revenue, 0);
  return deriveRoas(revenue, spend);
}

/* ─── Rank Badge ─────────────────────────────────────────────── */

const RANK_BADGES = ["🥇", "🥈", "🥉"] as const;

const RANK_BG = [
  "bg-amber-500/15 text-amber-300 border-amber-500/25",
  "bg-slate-400/15 text-slate-300 border-slate-400/25",
  "bg-orange-500/15 text-orange-300 border-orange-500/25",
  "bg-surface-2 text-ink-muted border-hairline",
  "bg-surface-2 text-ink-muted border-hairline",
] as const;

function RankBadge({ rank }: { rank: number }) {
  const isMedal = rank < 3;
  return (
    <span
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-sm font-bold ${RANK_BG[rank]}`}
    >
      {isMedal ? RANK_BADGES[rank] : rank + 1}
    </span>
  );
}

/* ─── Single Row ─────────────────────────────────────────────── */

function CampaignInsightRow({
  item,
  rank,
  metricLabel,
  formatValue,
  valueColor,
}: {
  item: CampaignInsight;
  rank: number;
  metricLabel: string;
  formatValue: (value: number) => string;
  valueColor: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-hairline bg-surface-2 px-3.5 py-3 transition-colors hover:border-hairline-strong">
      <RankBadge rank={rank} />

      <div className="min-w-0 flex-1">
        <p className="whitespace-normal break-words text-sm font-medium leading-snug text-ink">
          {item.name}
        </p>
      </div>

      <div className="flex-shrink-0 pl-2 text-right">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
          {metricLabel}
        </p>
        <p className={`tnum text-lg font-bold leading-tight ${valueColor}`}>
          {formatValue(item.value)}
        </p>
      </div>
    </div>
  );
}

/* ─── Card ───────────────────────────────────────────────────── */

function CampaignInsightCard({
  icon,
  title,
  subtitle,
  items,
  metricLabel,
  formatValue,
  valueColor,
  footerLabel,
  footerValue,
}: {
  icon: string;
  title: string;
  subtitle: string;
  items: CampaignInsight[];
  metricLabel: string;
  formatValue: (value: number) => string;
  valueColor: string;
  footerLabel: string;
  footerValue: string;
}) {
  return (
    <div className="flex flex-col rounded-[var(--radius-card)] border border-hairline bg-surface">
      {/* Header */}
      <div className="px-5 pb-3 pt-5">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
        </div>
        <p className="ml-7 text-xs text-ink-muted">{subtitle}</p>
      </div>

      <div className="mx-5 h-px bg-hairline" />

      {/* Rows */}
      <div className="flex flex-1 flex-col gap-2.5 px-5 py-4">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            No campaign data available.
          </p>
        ) : (
          items.map((item, index) => (
            <CampaignInsightRow
              key={item.campaign_id + index}
              item={item}
              rank={index}
              metricLabel={metricLabel}
              formatValue={formatValue}
              valueColor={valueColor}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {items.length > 0 && (
        <>
          <div className="mx-5 h-px bg-hairline" />
          <div className="flex items-center justify-between px-5 py-3.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              {footerLabel}
            </span>
            <span className="tnum text-sm font-bold text-ink">{footerValue}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Main Section ───────────────────────────────────────────── */

type Props = {
  campaigns: CampaignAggregate[];
};

export default function CampaignInsights({ campaigns }: Props) {
  const topByROAS = useMemo(() => getTopCampaignsByROAS(campaigns), [campaigns]);
  const topBySpend = useMemo(() => getTopCampaignsBySpend(campaigns), [campaigns]);
  const worstPerformers = useMemo(() => getWorstCampaigns(campaigns), [campaigns]);

  /* Footer summaries — ROAS is weighted (Σrevenue/Σspend), never a mean of ratios. */
  const avgTopROAS = useMemo(() => formatRoas(weightedRoas(topByROAS)), [topByROAS]);
  const combinedTopSpend = useMemo(
    () => formatCurrency(topBySpend.reduce((sum, c) => sum + c.value, 0), 0),
    [topBySpend]
  );
  const avgWorstROAS = useMemo(
    () => formatRoas(weightedRoas(worstPerformers)),
    [worstPerformers]
  );

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-ink">
        Executive Campaign Insights
      </h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <CampaignInsightCard
          icon="🏆"
          title="Top Performing"
          subtitle="Highest return on ad spend"
          items={topByROAS}
          metricLabel="ROAS"
          formatValue={(v) => formatRoas(v)}
          valueColor="text-positive"
          footerLabel="Weighted ROAS of Top 5"
          footerValue={avgTopROAS}
        />

        <CampaignInsightCard
          icon="💰"
          title="Highest Spend"
          subtitle="Where the budget is going"
          items={topBySpend}
          metricLabel="Spend"
          formatValue={(v) => formatCurrency(v, 0)}
          valueColor="text-ink"
          footerLabel="Combined Top 5 Spend"
          footerValue={combinedTopSpend}
        />

        <CampaignInsightCard
          icon="🚨"
          title="Needs Attention"
          subtitle="Lowest return on ad spend"
          items={worstPerformers}
          metricLabel="ROAS"
          formatValue={(v) => formatRoas(v)}
          valueColor="text-negative"
          footerLabel="Weighted ROAS"
          footerValue={avgWorstROAS}
        />
      </div>
    </div>
  );
}
