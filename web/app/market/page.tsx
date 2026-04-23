"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Market page · ADR 0016 V2 Azure Live polish.
 *
 * Hero eyebrow + h1 · KPI strip (gradient hero card + stat cards) · pill tabs
 * for 自选 / 持仓 · polished data table with per-row hover + inline search ·
 * mesh-hero empty state · shimmer skeleton loading · ConfirmDialog for
 * destructive row removal · refreshed drawer / form primitives.
 *
 * Data / state / fetch / mutation / navigation / testids are preserved
 * verbatim — only the visual shell is reworked.
 */

type Quote = {
  symbol: string;
  last: number;
  change: number;
  change_pct: number;
  ts: string;
  source: string;
};

type Watched = {
  id: string;
  symbol: string;
  name: string;
  tag: string | null;
  added_at: string;
};

type Holding = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_cost: number;
  opened_at: string | null;
  notes: string | null;
};

type PollerStatus = {
  running: boolean;
  last_tick_at: string | null;
  thresholds: {
    sudden_spike_pct: number;
    sudden_drop_pct: number;
    crash_pct: number;
    limit_up_pct: number;
    volume_spike_sigma: number;
    window_seconds: number;
  };
};

type Tab = "watched" | "holdings";

type RemoveTarget = {
  kind: Tab;
  symbol: string;
  name: string;
};

export default function MarketPage() {
  const [tab, setTab] = useState<Tab>("watched");
  const [watched, setWatched] = useState<Watched[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [status, setStatus] = useState<PollerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addWatchOpen, setAddWatchOpen] = useState(false);
  const [addHoldingOpen, setAddHoldingOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [removing, setRemoving] = useState(false);
  const [pollerBusy, setPollerBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, h, s] = await Promise.all([
        fetch("/api/market/watched").then((r) => r.json() as Promise<Watched[]>),
        fetch("/api/market/holdings").then((r) => r.json() as Promise<Holding[]>),
        fetch("/api/market/poller/status").then((r) => r.json() as Promise<PollerStatus>),
      ]);
      setWatched(w);
      setHoldings(h);
      setStatus(s);
      const allSymbols = Array.from(new Set([...w.map((x) => x.symbol), ...h.map((x) => x.symbol)]));
      if (allSymbols.length > 0) {
        const q = (await fetch("/api/market/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: allSymbols }),
        }).then((r) => r.json())) as Record<string, Quote>;
        setQuotes(q);
      }
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePoller() {
    if (pollerBusy) return;
    const endpoint = status?.running ? "stop" : "start";
    setPollerBusy(true);
    try {
      await fetch(`/api/market/poller/${endpoint}`, { method: "POST" });
      await load();
    } finally {
      setPollerBusy(false);
    }
  }

  async function handleRemoveConfirmed() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const base = removeTarget.kind === "watched" ? "watched" : "holdings";
      await fetch(`/api/market/${base}/${encodeURIComponent(removeTarget.symbol)}`, {
        method: "DELETE",
      });
      setRemoveTarget(null);
      await load();
    } finally {
      setRemoving(false);
    }
  }

  const totalPnL = useMemo(() => {
    let pnl = 0;
    for (const h of holdings) {
      const q = quotes[h.symbol];
      if (!q) continue;
      pnl += (q.last - h.avg_cost) * h.quantity;
    }
    return pnl;
  }, [holdings, quotes]);

  const totalCost = useMemo(
    () => holdings.reduce((s, h) => s + h.avg_cost * h.quantity, 0),
    [holdings],
  );
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const gainers = useMemo(
    () =>
      Object.values(quotes).filter((q) => q.change_pct > 0).length,
    [quotes],
  );
  const losers = useMemo(
    () =>
      Object.values(quotes).filter((q) => q.change_pct < 0).length,
    [quotes],
  );

  const q = query.trim().toLowerCase();
  const filteredWatched = q
    ? watched.filter(
        (x) =>
          x.symbol.toLowerCase().includes(q) ||
          x.name.toLowerCase().includes(q) ||
          (x.tag ?? "").toLowerCase().includes(q),
      )
    : watched;
  const filteredHoldings = q
    ? holdings.filter(
        (x) =>
          x.symbol.toLowerCase().includes(q) ||
          x.name.toLowerCase().includes(q),
      )
    : holdings;

  return (
    <AppShell title="行情">
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          {/* Eyebrow + hero header */}
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-primary-muted text-primary text-caption font-mono font-semibold uppercase tracking-wider">
                  <Icon name="activity" size={10} strokeWidth={2.25} />
                  Market
                </span>
                <span className="font-mono text-caption text-text-subtle uppercase tracking-wider">
                  quotes · positions · tickers
                </span>
              </div>
              <PageHeader
                title="行情"
                count={tab === "watched" ? watched.length : holdings.length}
                subtitle={
                  <>
                    跟踪自选与持仓的实时报价;ticker-poller 按设定阈值推送异动到 Lead Agent。
                    代码前缀 <span className="font-mono">SSE:</span> /{" "}
                    <span className="font-mono">SZSE:</span> 标记交易所。
                  </>
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void togglePoller()}
                data-testid="poller-toggle"
                disabled={pollerBusy}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-medium border shadow-soft-sm transition-colors duration-fast disabled:opacity-60 ${
                  status?.running
                    ? "border-danger/40 bg-danger-soft text-danger hover:border-danger"
                    : "border-border bg-surface text-text hover:border-border-strong hover:text-primary"
                }`}
              >
                <Icon name={status?.running ? "pause" : "play"} size={12} strokeWidth={2} />
                {status?.running ? "停 poller" : "启 poller"}
              </button>
              <button
                onClick={() =>
                  tab === "watched" ? setAddWatchOpen(true) : setAddHoldingOpen(true)
                }
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-medium bg-primary hover:bg-primary-hover text-primary-fg shadow-soft-sm transition-colors duration-fast"
              >
                <Icon name="plus" size={12} strokeWidth={2.25} />
                {tab === "watched" ? "加自选" : "加持仓"}
              </button>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <HeroKpi
              label="Poller"
              value={status?.running ? "Live" : "Idle"}
              icon="activity"
              hint={
                status?.last_tick_at
                  ? `tick ${new Date(status.last_tick_at).toLocaleTimeString()}`
                  : "awaiting first tick"
              }
              pulse={status?.running ?? false}
            />
            <StatKpi
              label="Watched"
              value={watched.length}
              icon="eye"
              hint={`${gainers} up · ${losers} down`}
            />
            <StatKpi
              label="Holdings"
              value={holdings.length}
              icon="layout-grid"
              hint={`cost ${totalCost.toFixed(0)}`}
              monoHint
            />
            <PnLKpi pnl={totalPnL} pnlPct={totalPnLPct} hasData={holdings.length > 0} />
          </div>

          {/* Poller thresholds strip */}
          {status && (
            <PollerStrip status={status} />
          )}

          {/* Tabs + search */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div
              role="tablist"
              aria-label="行情视图"
              className="inline-flex items-center gap-1 rounded-xl bg-surface-2 p-1 border border-border"
            >
              <TabPill
                active={tab === "watched"}
                icon="eye"
                label="自选"
                count={watched.length}
                onClick={() => setTab("watched")}
              />
              <TabPill
                active={tab === "holdings"}
                icon="layout-grid"
                label="持仓"
                count={holdings.length}
                onClick={() => setTab("holdings")}
              />
            </div>
            <SearchInput value={query} onChange={setQuery} />
          </div>

          {loading && <TableSkeleton />}

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-danger/15 text-danger shrink-0">
                  <Icon name="alert-circle" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-danger mb-1">加载行情失败</p>
                  <p className="text-xs text-text-muted font-mono break-all mb-3">{error}</p>
                  <button
                    onClick={() => void load()}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition-colors duration-fast"
                  >
                    <Icon name="refresh" size={12} />
                    重试
                  </button>
                </div>
              </div>
            </div>
          )}

          {!loading && tab === "watched" && (
            <WatchedTable
              rows={filteredWatched}
              totalRows={watched.length}
              quotes={quotes}
              onRequestRemove={(r) =>
                setRemoveTarget({ kind: "watched", symbol: r.symbol, name: r.name })
              }
              onAdd={() => setAddWatchOpen(true)}
            />
          )}
          {!loading && tab === "holdings" && (
            <HoldingsTable
              rows={filteredHoldings}
              totalRows={holdings.length}
              quotes={quotes}
              onRequestRemove={(r) =>
                setRemoveTarget({ kind: "holdings", symbol: r.symbol, name: r.name })
              }
              onAdd={() => setAddHoldingOpen(true)}
            />
          )}
        </div>
      </div>

      {addWatchOpen && (
        <AddWatchedDrawer
          onClose={() => setAddWatchOpen(false)}
          onSaved={async () => {
            setAddWatchOpen(false);
            await load();
          }}
        />
      )}
      {addHoldingOpen && (
        <AddHoldingDrawer
          onClose={() => setAddHoldingOpen(false)}
          onSaved={async () => {
            setAddHoldingOpen(false);
            await load();
          }}
        />
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title={`移除 ${removeTarget?.name ?? ""}?`}
        message={
          removeTarget?.kind === "holdings"
            ? "此操作会删除这笔持仓记录,不可撤销。历史成交历史仍会保留在 trace 里。"
            : "此操作会将该标的从自选列表移除,不可撤销。你可以随时重新添加。"
        }
        confirmLabel="移除"
        danger
        busy={removing}
        onConfirm={() => void handleRemoveConfirmed()}
        onCancel={() => setRemoveTarget(null)}
      />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------

function HeroKpi({
  label,
  value,
  icon,
  hint,
  pulse,
}: {
  label: string;
  value: string;
  icon: "activity";
  hint?: string;
  pulse?: boolean;
}) {
  return (
    <div
      data-testid={`kpi-${label.toLowerCase()}`}
      className="group relative overflow-hidden rounded-xl p-4 text-primary-fg shadow-soft transition duration-base hover:-translate-y-px hover:shadow-soft-lg"
      style={{
        background:
          "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl"
        style={{ background: "var(--color-primary-glow)", opacity: 0.4 }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-12 bottom-0 h-24 w-24 rounded-full blur-2xl"
        style={{ background: "var(--color-accent, var(--color-primary))", opacity: 0.28 }}
      />
      <div className="relative flex items-center justify-between">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider opacity-90">
          {label}
        </span>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
      </div>
      <div className="relative mt-3 flex items-center gap-2 text-xl font-bold tabular-nums leading-none">
        {pulse && (
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-white/80 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
        )}
        {value}
      </div>
      {hint && (
        <div className="relative mt-2 font-mono text-caption opacity-85 truncate">
          {hint}
        </div>
      )}
    </div>
  );
}

function StatKpi({
  label,
  value,
  icon,
  hint,
  monoHint = false,
}: {
  label: string;
  value: number | string;
  icon: "eye" | "layout-grid";
  hint?: string;
  monoHint?: boolean;
}) {
  return (
    <div
      data-testid={`kpi-${label.toLowerCase()}`}
      className="group relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft hover:border-border-strong"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text-subtle truncate">
          {label}
        </span>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-muted text-primary">
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
      </div>
      <div className="text-xl font-bold tabular-nums leading-none text-text">{value}</div>
      {hint && (
        <div
          className={`text-caption text-text-subtle truncate ${monoHint ? "font-mono" : ""}`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function PnLKpi({
  pnl,
  pnlPct,
  hasData,
}: {
  pnl: number;
  pnlPct: number;
  hasData: boolean;
}) {
  const positive = pnl >= 0;
  const icon = positive ? "trending-up" : "trending-down";
  const color = positive ? "text-success" : "text-danger";
  const bg = positive ? "bg-success-soft" : "bg-danger-soft";
  return (
    <div
      data-testid="kpi-pnl"
      className="group relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft hover:border-border-strong"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text-subtle truncate">
          P&L
        </span>
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${bg} ${color}`}>
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
      </div>
      <div
        className={`text-xl font-bold tabular-nums leading-none ${hasData ? color : "text-text-subtle"}`}
      >
        {hasData ? `${positive ? "+" : ""}${pnl.toFixed(2)}` : "—"}
      </div>
      <div
        className={`font-mono text-caption truncate ${
          hasData ? color : "text-text-subtle"
        }`}
      >
        {hasData ? `${positive ? "+" : ""}${pnlPct.toFixed(2)}%` : "无持仓"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Poller thresholds strip
// ---------------------------------------------------------------------------

function PollerStrip({ status }: { status: PollerStatus }) {
  const th = status.thresholds;
  const chips: Array<{ label: string; value: string }> = [
    { label: "↑ spike", value: `${th.sudden_spike_pct}%` },
    { label: "↓ drop", value: `${th.sudden_drop_pct}%` },
    { label: "crash", value: `${th.crash_pct}%` },
    { label: "limit-up", value: `${th.limit_up_pct}%` },
    { label: "σ volume", value: th.volume_spike_sigma.toString() },
    { label: "window", value: `${th.window_seconds}s` },
  ];
  return (
    <div className="relative rounded-xl border border-border bg-surface p-4 shadow-soft-sm overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/60 via-primary to-accent"
      />
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-caption uppercase tracking-wider text-text-subtle">
            Thresholds
          </span>
          <span
            className={`inline-flex items-center gap-1.5 h-5 px-2 rounded-full text-caption font-mono font-semibold ${
              status.running
                ? "bg-success-soft text-success"
                : "bg-surface-2 text-text-subtle"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${status.running ? "bg-success" : "bg-text-subtle"}`}
            />
            {status.running ? "live" : "idle"}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {chips.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1.5 h-6 px-2 rounded bg-surface-2 border border-border"
            >
              <span className="font-mono text-caption uppercase tracking-wider text-text-subtle">
                {c.label}
              </span>
              <span className="font-mono text-[11px] font-semibold text-text tabular-nums">
                {c.value}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs + search
// ---------------------------------------------------------------------------

function TabPill({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: "eye" | "layout-grid";
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] transition-colors duration-fast ${
        active
          ? "bg-surface text-text font-semibold shadow-soft-sm"
          : "text-text-muted hover:text-text font-medium"
      }`}
    >
      <Icon name={icon} size={12} strokeWidth={2} />
      {label}
      <span
        className={`inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded text-[10px] font-mono tabular-nums ${
          active ? "bg-primary-muted text-primary" : "bg-surface-3 text-text-subtle"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative flex-1 max-w-sm min-w-[200px]">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle">
        <Icon name="search" size={14} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜索代码 / 名称 / 标签"
        className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface border border-border text-[13px] text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary transition-colors duration-fast"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="清空搜索"
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-fast"
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function WatchedTable({
  rows,
  totalRows,
  quotes,
  onRequestRemove,
  onAdd,
}: {
  rows: Watched[];
  totalRows: number;
  quotes: Record<string, Quote>;
  onRequestRemove: (r: Watched) => void;
  onAdd: () => void;
}) {
  if (totalRows === 0) {
    return (
      <MarketEmpty
        title="还没有自选"
        description="从 SSE: / SZSE: 代码开始跟踪第一只标的,ticker-poller 会在异动时通知 Lead Agent。"
        cta={{ label: "加自选", icon: "plus", onClick: onAdd }}
      />
    );
  }
  if (rows.length === 0) {
    return <FilteredEmpty />;
  }
  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="text-[10px] uppercase tracking-wider text-text-subtle bg-surface-2">
          <tr>
            <Th>代码</Th>
            <Th>名称</Th>
            <Th>Tag</Th>
            <Th right>最新</Th>
            <Th right>涨跌</Th>
            <Th right>涨跌%</Th>
            <Th right> </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = quotes[r.symbol];
            const positive = q ? q.change >= 0 : false;
            return (
              <tr
                key={r.id}
                className="border-t border-border hover:bg-surface-2 transition-colors duration-fast"
              >
                <Td mono>
                  <Link
                    href={`/market/${encodeURIComponent(r.symbol)}`}
                    className="inline-flex items-center gap-1.5 text-text hover:text-primary transition-colors duration-fast"
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-primary-muted text-primary shrink-0">
                      <Icon name="activity" size={11} strokeWidth={2} />
                    </span>
                    {r.symbol}
                  </Link>
                </Td>
                <Td>{r.name}</Td>
                <Td>
                  {r.tag ? (
                    <span className="inline-flex items-center h-5 px-2 rounded bg-primary-muted text-primary text-[11px] font-medium">
                      {r.tag}
                    </span>
                  ) : (
                    <span className="text-text-subtle">—</span>
                  )}
                </Td>
                <Td right mono>
                  {q ? q.last.toFixed(2) : <span className="text-text-subtle">—</span>}
                </Td>
                <Td right mono color={q ? (positive ? "success" : "danger") : undefined}>
                  {q ? formatChange(q.change) : "—"}
                </Td>
                <Td right mono color={q ? (positive ? "success" : "danger") : undefined}>
                  {q ? `${positive ? "+" : ""}${q.change_pct.toFixed(2)}%` : "—"}
                </Td>
                <Td right>
                  <button
                    type="button"
                    onClick={() => onRequestRemove(r)}
                    aria-label={`移除 ${r.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:text-danger hover:bg-danger-soft transition-colors duration-fast"
                  >
                    <Icon name="trash-2" size={13} />
                  </button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HoldingsTable({
  rows,
  totalRows,
  quotes,
  onRequestRemove,
  onAdd,
}: {
  rows: Holding[];
  totalRows: number;
  quotes: Record<string, Quote>;
  onRequestRemove: (r: Holding) => void;
  onAdd: () => void;
}) {
  if (totalRows === 0) {
    return (
      <MarketEmpty
        title="还没有持仓"
        description="录入第一笔持仓,平台会按现价实时计算浮动盈亏。或让 Lead Agent 帮你 CSV 批量导入。"
        cta={{ label: "加持仓", icon: "plus", onClick: onAdd }}
      />
    );
  }
  if (rows.length === 0) {
    return <FilteredEmpty />;
  }
  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="text-[10px] uppercase tracking-wider text-text-subtle bg-surface-2">
          <tr>
            <Th>代码</Th>
            <Th>名称</Th>
            <Th right>数量</Th>
            <Th right>成本</Th>
            <Th right>现价</Th>
            <Th right>盈亏</Th>
            <Th right>盈亏%</Th>
            <Th right> </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = quotes[r.symbol];
            const pnl = q ? (q.last - r.avg_cost) * r.quantity : null;
            const pnlPct = q ? ((q.last - r.avg_cost) / r.avg_cost) * 100 : null;
            const positive = pnl !== null && pnl >= 0;
            return (
              <tr
                key={r.id}
                className="border-t border-border hover:bg-surface-2 transition-colors duration-fast"
              >
                <Td mono>
                  <Link
                    href={`/market/${encodeURIComponent(r.symbol)}`}
                    className="inline-flex items-center gap-1.5 text-text hover:text-primary transition-colors duration-fast"
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-primary-muted text-primary shrink-0">
                      <Icon name="layout-grid" size={11} strokeWidth={2} />
                    </span>
                    {r.symbol}
                  </Link>
                </Td>
                <Td>{r.name}</Td>
                <Td right mono>
                  {r.quantity}
                </Td>
                <Td right mono>
                  {r.avg_cost.toFixed(2)}
                </Td>
                <Td right mono>
                  {q ? q.last.toFixed(2) : <span className="text-text-subtle">—</span>}
                </Td>
                <Td right mono color={pnl !== null ? (positive ? "success" : "danger") : undefined}>
                  {pnl !== null ? formatChange(pnl) : "—"}
                </Td>
                <Td right mono color={pnlPct !== null ? (positive ? "success" : "danger") : undefined}>
                  {pnlPct !== null ? `${positive ? "+" : ""}${pnlPct.toFixed(2)}%` : "—"}
                </Td>
                <Td right>
                  <button
                    type="button"
                    onClick={() => onRequestRemove(r)}
                    aria-label={`移除 ${r.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:text-danger hover:bg-danger-soft transition-colors duration-fast"
                  >
                    <Icon name="trash-2" size={13} />
                  </button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  right,
}: {
  children?: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2.5 font-medium ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  mono,
  color,
}: {
  children?: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  color?: "success" | "danger";
}) {
  const cls =
    color === "success"
      ? "text-success"
      : color === "danger"
        ? "text-danger"
        : "text-text";
  return (
    <td
      className={`px-3 py-2.5 ${right ? "text-right" : "text-left"} ${
        mono ? "font-mono tabular-nums" : ""
      } ${cls}`}
    >
      {children}
    </td>
  );
}

function formatChange(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Empty + loading
// ---------------------------------------------------------------------------

function MarketEmpty({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta: { label: string; icon: "plus"; onClick: () => void };
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-surface p-12 text-center shadow-soft-sm">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, var(--color-primary-glow) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      <div className="relative mx-auto max-w-md">
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl text-primary-fg shadow-soft"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name="activity" size={22} strokeWidth={2} />
        </div>
        <h3 className="text-[18px] font-semibold tracking-tight text-text">{title}</h3>
        <p className="mt-2 text-[13px] text-text-muted">{description}</p>
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-5 inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-primary hover:bg-primary-hover text-primary-fg text-[13px] font-medium shadow-soft transition-colors duration-fast"
        >
          <Icon name={cta.icon} size={14} strokeWidth={2.25} />
          {cta.label}
        </button>
      </div>
    </section>
  );
}

function FilteredEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface px-5 py-10 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-primary-muted text-primary">
        <Icon name="search" size={16} />
      </div>
      <p className="text-[13px] text-text">没有匹配的结果</p>
      <p className="mt-1 text-[11px] text-text-muted">调整搜索词或清空筛选再试一次。</p>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden">
      <div className="h-9 bg-surface-2 border-b border-border" />
      <div className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-3 py-3">
            <div className="h-6 w-6 rounded bg-surface-3 animate-pulse" />
            <ShimmerBar width="12%" />
            <ShimmerBar width="18%" />
            <div className="flex-1" />
            <ShimmerBar width="10%" />
            <ShimmerBar width="10%" />
            <ShimmerBar width="8%" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ShimmerBar({ width }: { width: string }) {
  return (
    <div
      className="h-3 rounded bg-surface-2"
      style={{
        width,
        background:
          "linear-gradient(90deg, var(--color-surface-2) 0%, var(--color-surface-3) 50%, var(--color-surface-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "ah-shimmer 1.4s linear infinite",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Drawers / forms
// ---------------------------------------------------------------------------

function AddWatchedDrawer({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [symbol, setSymbol] = useState("SSE:");
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Drawer onClose={onClose} title="添加自选" subtitle="跟踪一只新标的到自选列表">
      <Field label="symbol" hint="例如 SSE:600519 / SZSE:000001" value={symbol} onChange={setSymbol} mono />
      <Field label="name" value={name} onChange={setName} />
      <Field label="tag" hint="可选 · 用于分组" value={tag} onChange={setTag} />
      {err && (
        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2">
          <Icon name="alert-circle" size={14} className="text-danger shrink-0 mt-0.5" />
          <p className="text-xs text-danger font-mono break-all">{err}</p>
        </div>
      )}
      <DrawerFooter
        onCancel={onClose}
        onConfirm={async () => {
          setBusy(true);
          setErr("");
          try {
            const res = await fetch("/api/market/watched", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ symbol, name, tag: tag || null }),
            });
            if (!res.ok) throw new Error(await res.text());
            await onSaved();
          } catch (e) {
            setErr(String(e));
          } finally {
            setBusy(false);
          }
        }}
        busy={busy}
      />
    </Drawer>
  );
}

function AddHoldingDrawer({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [symbol, setSymbol] = useState("SSE:");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("100");
  const [avgCost, setAvgCost] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Drawer onClose={onClose} title="添加持仓" subtitle="录入一笔实际持仓,用于计算浮动盈亏">
      <Field label="symbol" hint="例如 SSE:600519" value={symbol} onChange={setSymbol} mono />
      <Field label="name" value={name} onChange={setName} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="quantity" value={quantity} onChange={setQuantity} mono />
        <Field label="avg_cost" value={avgCost} onChange={setAvgCost} mono />
      </div>
      <Field label="notes" hint="可选" value={notes} onChange={setNotes} />
      {err && (
        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2">
          <Icon name="alert-circle" size={14} className="text-danger shrink-0 mt-0.5" />
          <p className="text-xs text-danger font-mono break-all">{err}</p>
        </div>
      )}
      <DrawerFooter
        onCancel={onClose}
        onConfirm={async () => {
          setBusy(true);
          setErr("");
          try {
            const res = await fetch("/api/market/holdings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                symbol,
                name,
                quantity: parseInt(quantity, 10) || 0,
                avg_cost: parseFloat(avgCost) || 0,
                notes: notes || null,
              }),
            });
            if (!res.ok) throw new Error(await res.text());
            await onSaved();
          } catch (e) {
            setErr(String(e));
          } finally {
            setBusy(false);
          }
        }}
        busy={busy}
      />
    </Drawer>
  );
}

function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end animate-fade-up"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md bg-surface border-l border-border shadow-soft-lg overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-text">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-[12px] text-text-muted">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-fast"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  mono,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">
          {label}
        </label>
        {hint && <span className="text-[11px] text-text-subtle">{hint}</span>}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full h-10 px-3 text-[13px] bg-surface border border-border rounded-md hover:border-border-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary transition-colors duration-fast ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

function DrawerFooter({
  onCancel,
  onConfirm,
  busy,
}: {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="pt-3 flex gap-2 justify-end border-t border-border -mx-6 px-6 mt-2">
      <button
        onClick={onCancel}
        className="h-9 px-3 rounded-lg bg-surface border border-border text-text hover:border-border-strong hover:bg-surface-2 text-[13px] font-medium transition-colors duration-fast"
      >
        取消
      </button>
      <button
        onClick={onConfirm}
        disabled={busy}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary hover:bg-primary-hover text-primary-fg text-[13px] font-medium shadow-soft-sm transition-colors duration-fast disabled:opacity-60"
      >
        {busy && (
          <span
            className="inline-block h-3 w-3 rounded-full border-2 border-primary-fg/40 border-t-primary-fg animate-spin"
            aria-hidden="true"
          />
        )}
        {busy ? "保存中…" : "保存"}
      </button>
    </div>
  );
}
