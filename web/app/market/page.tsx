"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";

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
    const endpoint = status?.running ? "stop" : "start";
    await fetch(`/api/market/poller/${endpoint}`, { method: "POST" });
    await load();
  }

  return (
    <AppShell
      title="行情"
      actions={
        <div className="flex gap-2">
          <button
            onClick={togglePoller}
            data-testid="poller-toggle"
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors duration-base ${
              status?.running
                ? "border-danger/40 text-danger hover:border-danger"
                : "border-border hover:border-border-strong"
            }`}
          >
            {status?.running ? "⏸ 停 poller" : "▶ 启 poller"}
          </button>
          <button
            onClick={() =>
              tab === "watched" ? setAddWatchOpen(true) : setAddHoldingOpen(true)
            }
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-fg hover:bg-primary-hover transition-colors duration-base"
          >
            {tab === "watched" ? "+ 加自选" : "+ 加持仓"}
          </button>
        </div>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">
          <PollerBar status={status} />

          <nav className="flex gap-1 border-b border-border">
            <TabButton current={tab} value="watched" onClick={setTab}>
              自选 ({watched.length})
            </TabButton>
            <TabButton current={tab} value="holdings" onClick={setTab}>
              持仓 ({holdings.length})
            </TabButton>
          </nav>

          {loading && (
            <div className="rounded-xl border border-border bg-surface p-10 text-center">
              <p className="text-sm text-text-muted">加载中…</p>
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-5">
              <p className="text-sm text-danger font-mono">{error}</p>
            </div>
          )}

          {!loading && tab === "watched" && (
            <WatchedTable rows={watched} quotes={quotes} onReload={load} />
          )}
          {!loading && tab === "holdings" && (
            <HoldingsTable rows={holdings} quotes={quotes} onReload={load} />
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
    </AppShell>
  );
}

function PollerBar({ status }: { status: PollerStatus | null }) {
  if (!status) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3 flex items-center gap-4">
      <span
        className={`h-2 w-2 rounded-full ${status.running ? "bg-success" : "bg-text-subtle"}`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-muted">
          ticker-poller {status.running ? "运行中" : "已停止"}
          {status.last_tick_at && (
            <span className="font-mono ml-2">
              上次 tick: {new Date(status.last_tick_at).toLocaleTimeString()}
            </span>
          )}
        </p>
        <p className="text-[11px] text-text-subtle mt-0.5 font-mono">
          阈值 ↑{status.thresholds.sudden_spike_pct}% · ↓{status.thresholds.sudden_drop_pct}% ·
          crash {status.thresholds.crash_pct}% · 窗口 {status.thresholds.window_seconds}s
        </p>
      </div>
    </div>
  );
}

function TabButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (v: Tab) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      className={`text-xs px-4 py-2 border-b-2 transition-colors duration-base ${
        active
          ? "border-primary text-text"
          : "border-transparent text-text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function WatchedTable({
  rows,
  quotes,
  onReload,
}: {
  rows: Watched[];
  quotes: Record<string, Quote>;
  onReload: () => Promise<void>;
}) {
  if (rows.length === 0)
    return (
      <div className="rounded-xl border border-border bg-surface p-10 text-center">
        <p className="text-sm text-text-muted">尚未添加自选 · 点右上 + 加自选</p>
      </div>
    );
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-text-muted">
          <tr>
            <Th>代码</Th>
            <Th>名称</Th>
            <Th>Tag</Th>
            <Th right>最新</Th>
            <Th right>涨跌</Th>
            <Th right>涨跌%</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = quotes[r.symbol];
            return (
              <tr key={r.id} className="border-t border-border">
                <Td mono>
                  <Link
                    href={`/market/${encodeURIComponent(r.symbol)}`}
                    className="hover:text-primary transition-colors duration-base"
                  >
                    {r.symbol}
                  </Link>
                </Td>
                <Td>{r.name}</Td>
                <Td muted>{r.tag ?? "—"}</Td>
                <Td right mono>
                  {q ? q.last.toFixed(2) : "—"}
                </Td>
                <Td right mono color={q && q.change >= 0 ? "success" : "danger"}>
                  {q ? formatChange(q.change) : "—"}
                </Td>
                <Td right mono color={q && q.change_pct >= 0 ? "success" : "danger"}>
                  {q ? `${q.change_pct.toFixed(2)}%` : "—"}
                </Td>
                <Td right>
                  <button
                    onClick={async () => {
                      await fetch(`/api/market/watched/${encodeURIComponent(r.symbol)}`, {
                        method: "DELETE",
                      });
                      await onReload();
                    }}
                    className="text-[11px] text-danger hover:underline"
                  >
                    移除
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
  quotes,
  onReload,
}: {
  rows: Holding[];
  quotes: Record<string, Quote>;
  onReload: () => Promise<void>;
}) {
  if (rows.length === 0)
    return (
      <div className="rounded-xl border border-border bg-surface p-10 text-center">
        <p className="text-sm text-text-muted">尚无持仓 · + 加持仓 或用 CSV 导入</p>
      </div>
    );
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-text-muted">
          <tr>
            <Th>代码</Th>
            <Th>名称</Th>
            <Th right>数量</Th>
            <Th right>成本</Th>
            <Th right>现价</Th>
            <Th right>盈亏</Th>
            <Th right>盈亏%</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = quotes[r.symbol];
            const pnl = q ? (q.last - r.avg_cost) * r.quantity : null;
            const pnlPct = q ? ((q.last - r.avg_cost) / r.avg_cost) * 100 : null;
            return (
              <tr key={r.id} className="border-t border-border">
                <Td mono>
                  <Link
                    href={`/market/${encodeURIComponent(r.symbol)}`}
                    className="hover:text-primary transition-colors duration-base"
                  >
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
                  {q ? q.last.toFixed(2) : "—"}
                </Td>
                <Td right mono color={pnl !== null && pnl >= 0 ? "success" : "danger"}>
                  {pnl !== null ? formatChange(pnl) : "—"}
                </Td>
                <Td right mono color={pnlPct !== null && pnlPct >= 0 ? "success" : "danger"}>
                  {pnlPct !== null ? `${pnlPct.toFixed(2)}%` : "—"}
                </Td>
                <Td right>
                  <button
                    onClick={async () => {
                      await fetch(`/api/market/holdings/${encodeURIComponent(r.symbol)}`, {
                        method: "DELETE",
                      });
                      await onReload();
                    }}
                    className="text-[11px] text-danger hover:underline"
                  >
                    移除
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
      className={`px-3 py-2 font-medium text-[11px] ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  mono,
  muted,
  color,
}: {
  children?: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  muted?: boolean;
  color?: "success" | "danger";
}) {
  const cls =
    color === "success"
      ? "text-success"
      : color === "danger"
        ? "text-danger"
        : muted
          ? "text-text-muted"
          : "text-text";
  return (
    <td
      className={`px-3 py-2 ${right ? "text-right" : "text-left"} ${
        mono ? "font-mono" : ""
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
    <Drawer onClose={onClose} title="添加自选">
      <Field label="symbol" value={symbol} onChange={setSymbol} mono />
      <Field label="name" value={name} onChange={setName} />
      <Field label="tag (可选)" value={tag} onChange={setTag} />
      {err && <p className="text-xs text-danger font-mono">{err}</p>}
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
    <Drawer onClose={onClose} title="添加持仓">
      <Field label="symbol" value={symbol} onChange={setSymbol} mono />
      <Field label="name" value={name} onChange={setName} />
      <Field label="quantity" value={quantity} onChange={setQuantity} mono />
      <Field label="avg_cost" value={avgCost} onChange={setAvgCost} mono />
      <Field label="notes (可选)" value={notes} onChange={setNotes} />
      {err && <p className="text-xs text-danger font-mono">{err}</p>}
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
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/30 flex justify-end"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md bg-bg border-l border-border overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-medium text-text">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors duration-base text-sm"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 text-xs bg-surface border border-border rounded-md hover:border-border-strong focus:border-primary focus:outline-none transition-colors duration-base ${
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
    <div className="pt-2 flex gap-2 justify-end">
      <button
        onClick={onCancel}
        className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-border-strong transition-colors duration-base"
      >
        取消
      </button>
      <button
        onClick={onConfirm}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-fg hover:bg-primary-hover transition-colors duration-base disabled:opacity-50"
      >
        {busy ? "保存中…" : "保存"}
      </button>
    </div>
  );
}
