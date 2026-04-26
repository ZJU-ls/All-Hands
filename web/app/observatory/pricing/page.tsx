"use client";

/**
 * /observatory/pricing · Read-only price table (L2 detail page).
 *
 * Shows the merged view that drives every cost number on the observatory
 * dashboard: code-seeded defaults vs. DB-overlay rows that an Agent (or
 * admin) added at runtime. The page is *read-only* on purpose — writes
 * happen through the price-curator skill (Tool First) so the audit trail
 * (source_url, note, who/when) is always populated.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/ui/icon";
import { fetchModelPrices, type PriceRowDto } from "@/lib/pricing-api";

type State = "idle" | "loading" | "ok" | "error";

function formatPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function PricingPage() {
  const t = useTranslations("pages.observatory.pricing");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PriceRowDto[]>([]);
  const [counts, setCounts] = useState<{ db: number; code: number; total: number }>({
    db: 0,
    code: 0,
    total: 0,
  });
  const [filter, setFilter] = useState<"all" | "db" | "code">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetchModelPrices()
      .then((res) => {
        if (cancelled) return;
        setRows(res.prices);
        setCounts({ db: res.db_count, code: res.code_count, total: res.count });
        setState("ok");
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "db" && r.source !== "db") return false;
      if (filter === "code" && r.source !== "code") return false;
      if (q && !r.model_ref.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, query]);

  return (
    <AppShell title={t("title")}>
      <div className="px-6 py-5 max-w-[1200px] mx-auto space-y-4">
        {/* Breadcrumb + header */}
        <div className="text-[12px] font-mono text-text-subtle flex items-center gap-1.5">
          <Link href="/observatory" className="hover:text-primary">
            {t("breadcrumb.observatory")}
          </Link>
          <Icon name="chevron-right" size={11} />
          <span className="text-text">{t("breadcrumb.pricing")}</span>
        </div>

        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-text flex items-center gap-2">
              <Icon name="tag" size={18} className="text-primary" />
              {t("title")}
            </h1>
            <p className="mt-1 text-[13px] text-text-muted max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-text-subtle">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              db {counts.db}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-text-subtle" />
              code {counts.code}
            </span>
            <span>· {counts.total} total</span>
          </div>
        </div>

        {/* Curator hint */}
        <div className="rounded-lg border border-primary/30 bg-primary-muted/40 p-3 text-[12px] text-text-muted flex items-start gap-2">
          <Icon name="info" size={14} className="text-primary mt-0.5 shrink-0" />
          <div>
            {t.rich("curatorHint", {
              chat: (chunks) => (
                <Link href="/chat" className="text-primary hover:underline">
                  {chunks}
                </Link>
              ),
              skill: (chunks) => <code className="font-mono">{chunks}</code>,
            })}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center rounded-md border border-border bg-surface p-0.5">
            {(
              [
                { k: "all", label: t("filter.all") },
                { k: "db", label: t("filter.db") },
                { k: "code", label: t("filter.code") },
              ] as const
            ).map((it) => {
              const active = filter === it.k;
              return (
                <button
                  type="button"
                  key={it.k}
                  onClick={() => setFilter(it.k)}
                  className={`h-7 px-3 text-[11px] rounded transition-colors duration-fast ${
                    active
                      ? "bg-primary-muted text-primary"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  {it.label}
                </button>
              );
            })}
          </div>
          <div className="relative ml-auto">
            <Icon
              name="search"
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-8 w-[260px] rounded-md border border-border bg-surface pl-8 pr-3 text-[12px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
            />
          </div>
        </div>

        {/* Table */}
        {state === "loading" ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center text-[12px] text-text-muted">
            <Icon name="loader" size={14} className="inline-block animate-spin mr-2" />
            {t("loading")}
          </div>
        ) : state === "error" ? (
          <div className="rounded-xl border border-danger/30 bg-danger-soft/30 p-4 text-[12px] text-danger">
            {t("loadFailed")} · {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center text-[12px] text-text-muted">
            {t("empty")}
          </div>
        ) : (
          <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-surface-2 text-left text-text-subtle border-b border-border">
                  <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium">
                    {t("col.model")}
                  </th>
                  <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium">
                    {t("col.source")}
                  </th>
                  <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums text-right">
                    {t("col.input")}
                  </th>
                  <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums text-right">
                    {t("col.output")}
                  </th>
                  <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium">
                    {t("col.note")}
                  </th>
                  <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium text-right">
                    {t("col.updated")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.model_ref}
                    className="border-b border-border last:border-b-0 hover:bg-surface-2/40"
                  >
                    <td className="py-2 px-4 font-mono text-[11px] text-primary">
                      <Link
                        href={`/observatory/models/${encodeURIComponent(row.model_ref)}`}
                        className="hover:underline"
                      >
                        {row.model_ref}
                      </Link>
                    </td>
                    <td className="py-2 px-4">
                      <SourceBadge source={row.source} url={row.source_url} />
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                      {formatPrice(row.input_per_million_usd)}
                      <span className="text-text-subtle"> / 1M</span>
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                      {formatPrice(row.output_per_million_usd)}
                      <span className="text-text-subtle"> / 1M</span>
                    </td>
                    <td className="py-2 px-4 text-[11px] text-text-muted truncate max-w-[260px]">
                      {row.note ?? <span className="text-text-subtle">—</span>}
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-[11px] text-text-subtle tabular-nums">
                      {formatDate(row.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function SourceBadge({ source, url }: { source: "code" | "db"; url: string | null }) {
  if (source === "db") {
    return (
      <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-mono bg-primary-muted text-primary">
        <Icon name="database" size={10} />
        db
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="ml-1 underline-offset-2 hover:underline"
            title={url}
          >
            <Icon name="external-link" size={10} />
          </a>
        ) : null}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-mono bg-surface-2 text-text-subtle border border-border">
      <Icon name="folder" size={10} />
      code
    </span>
  );
}
