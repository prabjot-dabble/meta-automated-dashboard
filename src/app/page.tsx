"use client";

import {
  IndianRupee,
  ShoppingCart,
  TrendingUp,
  MousePointerClick,
  Eye,
  BarChart3,
  Target,
  Megaphone,
  AlertTriangle,
} from "lucide-react";

import { useCallback, useEffect, useMemo, useState } from "react";

import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import SpendChart from "@/components/SpendChart";
import RoasTrendChart from "@/components/charts/RoasTrendChart";
import SpendDistribution from "@/components/charts/SpendDistribution";
import RevenueDistribution from "@/components/charts/RevenueDistribution";
import FunnelChart from "@/components/charts/FunnelChart";
import KPICard from "@/components/KPICard";
import CampaignTable from "@/components/CampaignTable";
import CampaignInsights from "@/components/CampaignInsights";
import FocusAreas from "@/components/FocusAreas";
import DebugPanel from "@/components/DebugPanel";

import {
  aggregateByCampaign,
  computeFunnel,
  computeTotals,
  filterActiveCampaigns,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRoas,
  getDailySeries,
} from "@/lib/metrics";

import { MetaCampaign } from "@/types/meta";

export default function Dashboard() {
  // Period rows (one per campaign — exact totals) drive KPIs + table;
  // daily rows drive the trend chart.
  const [periodRows, setPeriodRows] = useState<MetaCampaign[]>([]);
  const [dailyRows, setDailyRows] = useState<MetaCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState("last_30d");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [search, setSearch] = useState("");
  // "Active" = spent money in the selected range (see filterActiveCampaigns).
  const [activeOnly, setActiveOnly] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Dev flags read once from the URL.
  const [showDebug] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("debug") === "1"
  );
  // `?mock=1` renders realistic sample data without calling Meta (UI dev aid).
  const [useMock] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("mock") === "1"
  );
  // `?data=export` renders the real Ads Manager export (8 Jun–7 Jul) — a
  // presentation-safe source when the live API is blocked. Period-level only.
  const [useExport] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("data") === "export"
  );

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    // `ignore` guards against out-of-order responses when the preset changes
    // faster than requests resolve — only the latest request updates state.
    let ignore = false;

    // A custom range needs both endpoints before it can query.
    const customIncomplete =
      datePreset === "custom" && (!customSince || !customUntil);

    async function load() {
      setLoading(true);

      if (useMock) {
        const { MOCK_CAMPAIGNS } = await import("@/lib/mockData");
        if (ignore) return;
        setPeriodRows(MOCK_CAMPAIGNS);
        setDailyRows(MOCK_CAMPAIGNS);
        setError(null);
        setLastUpdated("mock data");
        setLoading(false);
        return;
      }

      if (useExport) {
        const { EXPORT_CAMPAIGNS } = await import("@/lib/exportData");
        if (ignore) return;
        setPeriodRows(EXPORT_CAMPAIGNS);
        setDailyRows(EXPORT_CAMPAIGNS); // period-level: no daily trend
        setError(null);
        setLastUpdated(null);
        setLoading(false);
        return;
      }

      if (customIncomplete) {
        setPeriodRows([]);
        setDailyRows([]);
        setError("Pick a start and end date for the custom range.");
        setLoading(false);
        return;
      }

      const query =
        datePreset === "custom"
          ? `since=${customSince}&until=${customUntil}`
          : `datePreset=${datePreset}`;

      try {
        const res = await fetch(`/api/meta?${query}`);
        const json = await res.json();
        if (ignore) return;

        if (Array.isArray(json?.campaigns) && Array.isArray(json?.daily)) {
          setPeriodRows(json.campaigns);
          setDailyRows(json.daily);
          setError(null);
          setLastUpdated(
            new Date().toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })
          );
        } else {
          setPeriodRows([]);
          setDailyRows([]);
          setError(
            json?.error?.message ??
              "The Meta API returned an unexpected response."
          );
        }
      } catch (err) {
        if (ignore) return;
        console.error(err);
        setPeriodRows([]);
        setDailyRows([]);
        setError(
          "Could not reach the dashboard API. Check your connection and try again."
        );
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [datePreset, customSince, customUntil, reloadKey, useMock, useExport]);

  // -----------------------------------------------------------------
  // Derived data — all from the single source of truth (@/lib/metrics).
  // KPIs, chart and insights are account-wide; only the TABLE responds
  // to the search box.
  // -----------------------------------------------------------------
  const totals = useMemo(() => computeTotals(periodRows), [periodRows]);
  const campaigns = useMemo(
    () => aggregateByCampaign(periodRows),
    [periodRows]
  );
  const chartData = useMemo(() => getDailySeries(dailyRows), [dailyRows]);
  // Funnel is account-wide for the exact selected range — built from the same
  // exact-match period rows as the KPIs, not the daily rows.
  const funnelStages = useMemo(() => computeFunnel(periodRows), [periodRows]);

  // Campaigns with real spend in this range — badge count and the basis for
  // the "Active" toggle. Feeds the table + insights + focus areas + campaign
  // charts; KPI totals and the funnel stay account-wide (zero-spend
  // campaigns don't change those sums anyway).
  const activeCampaigns = useMemo(
    () => filterActiveCampaigns(campaigns),
    [campaigns]
  );
  const visibleCampaigns = activeOnly ? activeCampaigns : campaigns;

  const filteredCampaigns = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return visibleCampaigns;
    return visibleCampaigns.filter((c) =>
      (c.campaign_name ?? "").toLowerCase().includes(query)
    );
  }, [visibleCampaigns, search]);

  const initialLoading = loading && periodRows.length === 0 && !error;
  const hasData = periodRows.length > 0;

  return (
    <div className="flex min-h-screen bg-plane">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          datePreset={datePreset}
          onDatePresetChange={setDatePreset}
          customSince={customSince}
          customUntil={customUntil}
          onCustomSinceChange={setCustomSince}
          onCustomUntilChange={setCustomUntil}
          search={search}
          onSearchChange={setSearch}
          activeOnly={activeOnly}
          onActiveOnlyChange={setActiveOnly}
          activeCampaignCount={activeCampaigns.length}
          onRefresh={refresh}
          refreshing={loading}
          lastUpdated={lastUpdated}
          sourceLabel={
            useExport ? "Ads Manager export · 8 Jun – 7 Jul 2026" : undefined
          }
        />

        <main className="flex-1 px-5 py-6 md:px-8">
          {initialLoading ? (
            <KpiSkeleton />
          ) : error && !hasData ? (
            <ErrorState message={error} onRetry={refresh} retrying={loading} />
          ) : !hasData ? (
            <EmptyState onRetry={refresh} />
          ) : (
            <div className="mx-auto max-w-[1400px] space-y-10">
              {/* KPI grid */}
              <section id="overview" className="animate-in scroll-mt-24">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <KPICard
                    title="Spend"
                    value={formatCurrency(totals.spend)}
                    hint={`${formatCurrency(totals.cpm)} CPM`}
                    accent="var(--series-1)"
                    icon={<IndianRupee size={18} />}
                  />
                  <KPICard
                    title="Revenue"
                    value={formatCurrency(totals.revenue)}
                    accent="var(--positive)"
                    icon={<TrendingUp size={18} />}
                  />
                  <KPICard
                    title="ROAS"
                    value={formatRoas(totals.roas)}
                    hint={`${formatCurrency(totals.revenue, 0)} on ${formatCurrency(
                      totals.spend,
                      0
                    )}`}
                    accent="var(--accent)"
                    icon={<BarChart3 size={18} />}
                    featured
                  />
                  <KPICard
                    title="Purchases"
                    value={formatNumber(totals.purchases)}
                    hint={`${formatCurrency(totals.costPerPurchase)} per purchase`}
                    accent="var(--series-3)"
                    icon={<ShoppingCart size={18} />}
                  />
                  <KPICard
                    title="Impressions"
                    value={formatNumber(totals.impressions)}
                    accent="var(--series-4)"
                    icon={<Eye size={18} />}
                  />
                  <KPICard
                    title="Clicks"
                    value={formatNumber(totals.clicks)}
                    accent="var(--series-6)"
                    icon={<MousePointerClick size={18} />}
                  />
                  <KPICard
                    title="Avg CTR"
                    value={formatPercent(totals.ctr)}
                    hint={`${formatCurrency(totals.cpc)} CPC`}
                    accent="var(--series-2)"
                    icon={<Target size={18} />}
                  />
                  <KPICard
                    title="Campaigns"
                    value={formatNumber(totals.campaignCount)}
                    accent="var(--ink-secondary)"
                    icon={<Megaphone size={18} />}
                  />
                </div>
              </section>

              {/* Trend charts — hidden when the source has no daily granularity */}
              <section id="performance" className="scroll-mt-24 space-y-4">
                {chartData.length >= 2 ? (
                  <>
                    <SpendChart data={chartData} />
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <RoasTrendChart data={chartData} />
                      <SpendDistribution campaigns={visibleCampaigns} />
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <SpendDistribution campaigns={visibleCampaigns} />
                    <div className="flex items-center justify-center rounded-[var(--radius-card)] border border-dashed border-hairline bg-surface p-8 text-center text-sm text-ink-muted">
                      Daily trend charts require the live Meta API (this view uses
                      period-level export data).
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <FunnelChart stages={funnelStages} />
                  <RevenueDistribution campaigns={visibleCampaigns} />
                </div>
              </section>

              {/* Executive insights */}
              <section id="insights" className="scroll-mt-24 space-y-8">
                <CampaignInsights campaigns={visibleCampaigns} />
                <FocusAreas campaigns={visibleCampaigns} />
              </section>

              {/* Campaign table */}
              <section id="campaigns" className="scroll-mt-24">
                <CampaignTable campaigns={filteredCampaigns} />
              </section>

              {/* Developer traceability (?debug=1) */}
              {showDebug && <DebugPanel data={periodRows} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ─── States ─────────────────────────────────────────────────── */

function KpiSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[116px] animate-pulse rounded-[var(--radius-card)] border border-hairline bg-surface"
          />
        ))}
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-[var(--radius-card)] border border-hairline bg-surface p-8 text-center">
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
      >
        <AlertTriangle size={22} />
      </div>
      <h2 className="text-lg font-semibold text-ink">Couldn’t load data</h2>
      <p className="mt-2 text-sm text-ink-secondary">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-5 inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{
          background: "linear-gradient(135deg, var(--accent-2), var(--accent))",
        }}
      >
        {retrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}

function EmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-[var(--radius-card)] border border-hairline bg-surface p-8 text-center">
      <h2 className="text-lg font-semibold text-ink">No data in this range</h2>
      <p className="mt-2 text-sm text-ink-secondary">
        Meta returned no campaigns for the selected dates. Try a different date
        range.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-2 rounded-[10px] border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-hairline-strong"
      >
        Refresh
      </button>
    </div>
  );
}
