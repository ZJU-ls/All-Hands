"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/ui/icon";
import { Sparkline } from "@/components/ui/Sparkline";

/**
 * Market / symbol detail · single-ticker dashboard (ADR 0016 · V2 Azure Live).
 *
 * Hero card = symbol + price + change pill + interval pills + watch action.
 * Price history sparkline below uses the viz palette via Sparkline.
 * News / announcements rendered as compact card lists with icon tiles.
 *
 * Data / state / fetch / navigation logic unchanged.
 */

type Bar = {
  symbol: string;
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ts: string;
};

type Quote = {
  symbol: string;
  last: number;
  change: number;
  change_pct: number;
  ts: string;
  source: string;
};

type News = {
  id: string;
  symbol: string | null;
  title: string;
  summary: string;
  url: string;
  published_at: string;
  source: string;
};

const INTERVALS: Array<{ id: Bar["interval"]; label: string }> = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "30m", label: "30m" },
  { id: "1h", label: "1h" },
  { id: "1d", label: "1d" },
];

export default function SymbolDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = use(params);
  const decoded = decodeURIComponent(symbol);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [announcements, setAnnouncements] = useState<News[]>([]);
  const [interval, setInterval] = useState<Bar["interval"]>("1d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [q, b, n, a] = await Promise.all([
        fetch(`/api/market/quote/${encodeURIComponent(decoded)}`).then((r) =>
          r.ok ? (r.json() as Promise<Quote>) : null,
        ),
        fetch(
          `/api/market/bars/${encodeURIComponent(decoded)}?interval=${interval}`,
        ).then((r) => (r.ok ? (r.json() as Promise<Bar[]>) : [])),
        fetch(`/api/market/news?symbol=${encodeURIComponent(decoded)}`).then((r) =>
          r.ok ? (r.json() as Promise<News[]>) : [],
        ),
        fetch(
          `/api/market/announcements?symbol=${encodeURIComponent(decoded)}`,
        ).then((r) => (r.ok ? (r.json() as Promise<News[]>) : [])),
      ]);
      setQuote(q);
      setBars(b);
      setNews(n);
      setAnnouncements(a);
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [decoded, interval]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell
      title={decoded}
      actions={
        <Link
          href="/market"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition-colors duration-fast"
        >
          <Icon name="arrow-left" size={12} />
          返回行情
        </Link>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger">
              <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words font-mono">{error}</span>
            </div>
          )}

          <QuoteHero symbol={decoded} quote={quote} loading={loading && !quote} />

          <Section
            icon="activity"
            title={`价格曲线 · ${interval}`}
            subtitle={
              bars.length > 0
                ? `${bars.length} 根 K 线 · 关闭价走势`
                : "等待 provider 返回数据"
            }
            actions={
              <div
                role="tablist"
                aria-label="时间范围"
                className="inline-flex items-center gap-1 rounded-lg bg-surface-2 p-1 border border-border"
              >
                {INTERVALS.map((iv) => (
                  <button
                    key={iv.id}
                    role="tab"
                    aria-selected={iv.id === interval}
                    onClick={() => setInterval(iv.id)}
                    className={`inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-mono transition-colors duration-fast ${
                      iv.id === interval
                        ? "bg-surface text-primary font-semibold shadow-soft-sm"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    {iv.label}
                  </button>
                ))}
              </div>
            }
          >
            {loading && bars.length === 0 ? (
              <ChartSkeleton />
            ) : bars.length === 0 ? (
              <EmptyChart />
            ) : (
              <PriceChart bars={bars} />
            )}
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NewsCard icon="book-open" title="近期新闻" rows={news} />
            <NewsCard icon="bell" title="公告" rows={announcements} />
          </div>

          <FooterActions decoded={decoded} />
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Quote hero
// ---------------------------------------------------------------------------

function QuoteHero({
  symbol,
  quote,
  loading,
}: {
  symbol: string;
  quote: Quote | null;
  loading: boolean;
}) {
  const positive = quote ? quote.change >= 0 : false;
  return (
    <section
      data-testid="market-symbol-hero"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-surface to-surface border border-primary/20 shadow-soft-lg p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full blur-3xl opacity-60"
        style={{ background: "var(--color-primary-glow)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/70 via-primary to-accent"
      />

      <div className="relative flex items-start gap-5 flex-wrap">
        <div
          className="grid h-16 w-16 place-items-center rounded-2xl text-primary-fg shadow-soft shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name="activity" size={26} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-primary-muted text-primary text-caption font-mono font-semibold uppercase tracking-wider">
              Ticker
            </span>
            <span className="font-mono text-caption text-text-subtle uppercase tracking-wider">
              {symbol.startsWith("SSE:")
                ? "Shanghai"
                : symbol.startsWith("SZSE:")
                  ? "Shenzhen"
                  : "exchange"}
            </span>
          </div>
          <h1 className="mt-1 text-[28px] md:text-[32px] font-semibold tracking-tight text-text font-mono">
            {symbol}
          </h1>
          {loading && !quote ? (
            <p className="mt-2 text-[13px] text-text-muted">
              <span className="inline-block h-4 w-32 rounded bg-surface-2 animate-pulse align-middle" />
            </p>
          ) : quote ? (
            <div className="mt-3 flex items-baseline gap-3 flex-wrap">
              <span className="text-[40px] font-bold tabular-nums text-text leading-none font-mono">
                {quote.last.toFixed(2)}
              </span>
              <span
                className={`inline-flex items-center gap-1 h-7 px-3 rounded-full font-mono text-[13px] font-semibold ${
                  positive
                    ? "bg-success-soft text-success"
                    : "bg-danger-soft text-danger"
                }`}
              >
                <Icon
                  name={positive ? "trending-up" : "trending-down"}
                  size={12}
                  strokeWidth={2.25}
                />
                {positive ? "+" : ""}
                {quote.change.toFixed(2)} ({positive ? "+" : ""}
                {quote.change_pct.toFixed(2)}%)
              </span>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-text-muted">
              暂无报价 · provider 未缓存。
            </p>
          )}
          {quote && (
            <p className="mt-3 font-mono text-caption text-text-subtle">
              src: {quote.source} · {new Date(quote.ts).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/chat?prefill=${encodeURIComponent(`问老张:${symbol} 为什么异动`)}`}
            data-testid="market-symbol-ask"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-primary-fg text-[13px] font-semibold shadow-soft hover:-translate-y-px transition duration-base"
          >
            <Icon name="sparkles" size={14} />
            问老张
          </Link>
          <Link
            href="/market"
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-border bg-surface text-[13px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
          >
            <Icon name="eye" size={14} />
            自选
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  subtitle,
  actions,
  children,
}: {
  icon: "activity" | "book-open" | "bell";
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border flex-wrap">
        <div className="min-w-0 flex items-start gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-muted text-primary shrink-0">
            <Icon name={icon} size={14} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-tight text-text">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-caption text-text-muted truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Price chart
// ---------------------------------------------------------------------------

function PriceChart({ bars }: { bars: Bar[] }) {
  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const normalised = useMemo(
    () => closes.map((c) => (c - min) / range),
    [closes, min, range],
  );
  const first = closes[0] ?? 0;
  const last = closes[closes.length - 1] ?? 0;
  const delta = last - first;
  const deltaPct = first !== 0 ? (delta / first) * 100 : 0;
  const positive = delta >= 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono text-caption uppercase tracking-wider text-text-subtle">
            区间涨跌
          </p>
          <div
            className={`mt-1 text-[20px] font-semibold tabular-nums font-mono ${
              positive ? "text-success" : "text-danger"
            }`}
          >
            {positive ? "+" : ""}
            {delta.toFixed(2)}
            <span className="ml-2 text-[13px]">
              ({positive ? "+" : ""}
              {deltaPct.toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 font-mono text-caption text-text-muted">
          <span>min {min.toFixed(2)}</span>
          <span>max {max.toFixed(2)}</span>
          <span>{bars.length} bars</span>
        </div>
      </div>
      <div
        className={`rounded-lg bg-surface-2 border border-border p-4 ${
          positive ? "text-success" : "text-danger"
        }`}
      >
        <Sparkline
          values={normalised}
          height={180}
          strokeWidth={2}
          filled
          ariaLabel={`${bars.length} bar price chart`}
        />
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="rounded-lg bg-surface-2 border border-border p-4">
      <div className="h-[180px] w-full rounded bg-surface-3 animate-pulse" />
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="relative">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary-muted text-primary">
          <Icon name="activity" size={20} strokeWidth={2} />
        </div>
        <p className="text-[14px] text-text">暂无 K 线数据</p>
        <p className="mt-1 text-[12px] text-text-muted">
          provider 未返回该区间 / 未缓存 · 切换时间范围再试一次。
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// News list
// ---------------------------------------------------------------------------

function NewsCard({
  icon,
  title,
  rows,
}: {
  icon: "book-open" | "bell";
  title: string;
  rows: News[];
}) {
  return (
    <Section
      icon={icon}
      title={`${title} · ${rows.length}`}
      subtitle={rows.length === 0 ? "暂无" : `最新 ${Math.min(rows.length, 10)} 条`}
    >
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center">
          <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-xl bg-primary-muted text-primary">
            <Icon name={icon} size={14} />
          </div>
          <p className="text-[13px] text-text-muted">暂无内容</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 10).map((n) => (
            <li key={n.id}>
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 hover:-translate-y-px hover:shadow-soft hover:border-border-strong transition duration-base"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-muted text-primary shrink-0">
                  <Icon name={icon} size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-text group-hover:text-primary transition-colors duration-fast truncate">
                    {n.title}
                  </p>
                  <p className="mt-0.5 font-mono text-caption text-text-subtle truncate">
                    {new Date(n.published_at).toLocaleString()} · {n.source}
                  </p>
                </div>
                <Icon
                  name="external-link"
                  size={12}
                  className="mt-1 text-text-subtle group-hover:text-primary transition-colors duration-fast"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Footer actions
// ---------------------------------------------------------------------------

function FooterActions({ decoded }: { decoded: string }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Link
        href={`/chat?prefill=${encodeURIComponent(`为 ${decoded} 写一段研究纪要`)}`}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
      >
        <Icon name="file-code-2" size={12} />
        生成研究纪要
      </Link>
      <Link
        href="/market"
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
      >
        <Icon name="plus" size={12} />
        加到持仓
      </Link>
    </div>
  );
}
