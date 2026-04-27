"use client";

/**
 * KBCard — single KB card on the L1 hub grid.
 *
 * Job: at a glance answer "is this KB worth opening?" — show name +
 * description + 3 KPI numbers + 30-day sparkline + top tags + mode badge
 * (Ask-ready / demo / stale embedding warning). Click anywhere on the card
 * routes into /knowledge/[kbId].
 *
 * Sparkline / formatCompact / formatRelativeTime are inlined here — they were
 * private helpers on the old single page; keeping a copy here avoids a
 * circular import while we migrate.
 */

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import type { KBDto, KBHealthDto } from "@/lib/kb-api";

export function KBCard({
  kb,
  health,
}: {
  kb: KBDto;
  health: KBHealthDto | null;
}) {
  const t = useTranslations("knowledge.card");
  const isMock = kb.embedding_model_ref.startsWith("mock:");
  const stale = (health?.chunks_missing_embeddings ?? 0) > 0;

  return (
    <div
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-surface p-5 transition duration-fast hover:border-primary/40 hover:shadow-soft-md ${
        stale
          ? "border-warning/40"
          : isMock
            ? "border-warning/30"
            : "border-border"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon name="book-open" size={14} className="text-primary" />
            <h3 className="truncate text-[15px] font-semibold text-text">
              {kb.name}
            </h3>
          </div>
          {kb.description && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-text-muted">
              {kb.description}
            </p>
          )}
        </div>
        <Icon
          name="chevron-right"
          size={14}
          className="text-text-subtle transition group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </div>

      {/* KPI row */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <KpiCell label={t("docs")} value={kb.document_count.toString()} />
        <KpiCell label={t("chunks")} value={formatCompact(kb.chunk_count)} />
        <KpiCell
          label={t("tokens")}
          value={health ? formatCompact(health.token_sum) : "—"}
        />
      </div>

      {/* Sparkline */}
      <div className="mt-3">
        <div className="font-mono text-[10px] text-text-subtle">
          {t("activity30d")}
        </div>
        <Sparkline data={health?.daily_doc_counts.map((d) => d.count) ?? []} />
      </div>

      {/* Tags + mode badges */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {(health?.top_tags ?? []).slice(0, 4).map((tg) => (
          <span
            key={tg.tag}
            className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-muted"
          >
            #{tg.tag}
          </span>
        ))}
      </div>

      {/* Footer status */}
      <div className="mt-3 flex items-center justify-between text-[10px] text-text-subtle">
        <span className="font-mono">
          {health?.last_activity
            ? formatRelativeTime(new Date(health.last_activity))
            : t("never")}
        </span>
        {stale ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-warning">
            <Icon name="alert-triangle" size={10} />
            {t("staleEmbedding", {
              missing: health?.chunks_missing_embeddings ?? 0,
            })}
          </span>
        ) : isMock ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-warning">
            <Icon name="alert-triangle" size={10} />
            {t("demoMode")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-soft px-2 py-0.5 text-success">
            <Icon name="check" size={10} />
            {t("ready")}
          </span>
        )}
      </div>
    </div>
  );
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-text-subtle">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14px] font-semibold text-text">
        {value}
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const W = 100;
  const H = 22;
  const safe = data.length > 0 ? data : new Array(30).fill(0);
  const max = Math.max(1, ...safe);
  const barW = W / Math.max(1, safe.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-1 h-6 w-full"
      aria-hidden="true"
    >
      {safe.map((v, i) => {
        const h = v === 0 ? 1 : Math.max(2, (v / max) * H);
        const x = i * barW;
        const y = H - h;
        const fill = v === 0 ? "var(--color-border)" : "var(--color-primary)";
        return (
          <rect
            key={i}
            x={x + 0.3}
            y={y}
            width={Math.max(0.5, barW - 0.6)}
            height={h}
            fill={fill}
            rx="0.5"
          />
        );
      })}
    </svg>
  );
}

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatRelativeTime(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toISOString().slice(0, 10);
}
