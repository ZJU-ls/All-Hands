"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";

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

const INTERVALS: Array<Bar["interval"]> = ["1m", "5m", "15m", "30m", "1h", "1d"];

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
          r.ok ? (r.json() as Promise<Quote>) : null
        ),
        fetch(
          `/api/market/bars/${encodeURIComponent(decoded)}?interval=${interval}`
        ).then((r) => (r.ok ? (r.json() as Promise<Bar[]>) : [])),
        fetch(`/api/market/news?symbol=${encodeURIComponent(decoded)}`).then(
          (r) => (r.ok ? (r.json() as Promise<News[]>) : [])
        ),
        fetch(`/api/market/announcements?symbol=${encodeURIComponent(decoded)}`).then(
          (r) => (r.ok ? (r.json() as Promise<News[]>) : [])
        ),
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
          className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-border-strong transition-colors duration-base"
        >
          ← 返回
        </Link>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">
          {loading && (
            <div className="rounded-xl border border-border bg-surface p-10 text-center">
              <p className="text-sm text-text-muted">加载中…</p>
            </div>
          )}
          {error && (
            <p className="text-xs text-danger font-mono">{error}</p>
          )}
          {quote && <QuoteHeader q={quote} />}

          <section className="rounded-xl border border-border bg-surface">
            <header className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-medium text-text">K 线 ({interval})</h3>
              <div className="flex gap-1">
                {INTERVALS.map((iv) => (
                  <button
                    key={iv}
                    onClick={() => setInterval(iv)}
                    className={`text-[11px] px-2 py-1 rounded font-mono transition-colors duration-base ${
                      iv === interval
                        ? "bg-primary/10 text-primary"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    {iv}
                  </button>
                ))}
              </div>
            </header>
            <div className="px-4 py-3">
              {bars.length === 0 ? (
                <p className="text-xs text-text-subtle">暂无数据 · provider 可能未返回 / 未缓存</p>
              ) : (
                <AsciiSpark bars={bars} />
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <NewsCard title="近期新闻" rows={news} />
            <NewsCard title="公告" rows={announcements} />
          </section>

          <div className="flex gap-2">
            <Link
              href={`/chat?prefill=${encodeURIComponent(`问老张:${decoded} 为什么异动`)}`}
              className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-primary border border-primary/30 hover:bg-primary/10 transition-colors duration-base"
            >
              → 问老张归因
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function QuoteHeader({ q }: { q: Quote }) {
  const positive = q.change >= 0;
  return (
    <div className="rounded-xl border border-border bg-surface px-5 py-4 flex items-baseline gap-4">
      <span className="text-2xl font-mono text-text">{q.last.toFixed(2)}</span>
      <span
        className={`text-sm font-mono ${positive ? "text-success" : "text-danger"}`}
      >
        {positive ? "+" : ""}
        {q.change.toFixed(2)} ({positive ? "+" : ""}
        {q.change_pct.toFixed(2)}%)
      </span>
      <span className="text-[11px] text-text-subtle ml-auto font-mono">
        src: {q.source} · {new Date(q.ts).toLocaleTimeString()}
      </span>
    </div>
  );
}

function AsciiSpark({ bars }: { bars: Bar[] }) {
  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const chars = " ▁▂▃▄▅▆▇█";
  const spark = closes
    .map((c) => {
      const idx = Math.round(((c - min) / range) * (chars.length - 1));
      return chars[idx];
    })
    .join("");
  return (
    <div>
      <pre className="text-xs font-mono text-text whitespace-pre-wrap break-all">
        {spark}
      </pre>
      <p className="text-[11px] text-text-subtle mt-2 font-mono">
        {bars.length} bars · min {min.toFixed(2)} · max {max.toFixed(2)}
      </p>
    </div>
  );
}

function NewsCard({ title, rows }: { title: string; rows: News[] }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-text">
          {title} ({rows.length})
        </h3>
      </header>
      <div className="px-4 py-3 space-y-2">
        {rows.length === 0 && (
          <p className="text-xs text-text-subtle">暂无数据</p>
        )}
        {rows.map((n) => (
          <a
            key={n.id}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block border-b border-border last:border-b-0 pb-2 last:pb-0 hover:text-primary transition-colors duration-base"
          >
            <p className="text-xs text-text truncate">{n.title}</p>
            <p className="text-[11px] text-text-subtle font-mono">
              {new Date(n.published_at).toLocaleString()} · {n.source}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}
