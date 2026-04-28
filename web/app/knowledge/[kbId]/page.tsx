"use client";

/**
 * /knowledge/[kbId] · Overview tab (default landing for an L2 KB).
 *
 * Job: "what's in here / when did I last touch it / what can I do?".
 * Read-only summary + quick-action buttons that link into the other L2 tabs.
 *
 * Sections:
 *   - Hero strip (description, editable later)
 *   - Health (full-width; KPI + 30-day sparkline + top tags + dominant mime)
 *   - Recent uploads (last 5)
 *   - Suggested starter questions (lazy-loaded; only when KB has docs)
 *   - Quick actions: Upload / Ingest URL / Ask / Settings
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { useKBContext } from "@/components/knowledge/KBContext";
import { SkeletonRow } from "@/components/knowledge/Skeleton";
import {
  type DocumentDto,
  getStarterQuestions,
  listDocuments,
} from "@/lib/kb-api";

export default function OverviewPage() {
  const { kb, health } = useKBContext();
  const t = useTranslations("knowledge.overview");
  const tStarter = useTranslations("knowledge.starters");
  const router = useRouter();
  const [recent, setRecent] = useState<DocumentDto[] | null>(null);
  const [starters, setStarters] = useState<string[] | null>(null);

  useEffect(() => {
    listDocuments(kb.id, { limit: 5 })
      .then(setRecent)
      .catch(() => setRecent([]));
    getStarterQuestions(kb.id, 4)
      .then(setStarters)
      .catch(() => setStarters([]));
  }, [kb.id]);

  const sparkline = useMemo(
    () => health?.daily_doc_counts ?? [],
    [health],
  );

  // Empty-KB onboarding: when this KB has zero documents, swap the
  // multi-card layout for a single "first run" hero. Avoids 4 empty boxes
  // shouting "loading…" / "(empty)".
  if (kb.document_count === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl py-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-muted">
            <Icon name="upload" size={26} className="text-primary" />
          </div>
          <h2 className="text-[20px] font-semibold text-text">
            {t("welcomeTitle", { kb: kb.name })}
          </h2>
          <p className="mt-2 text-[13px] text-text-muted">
            {t("welcomeBody")}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link
              href={`/knowledge/${kb.id}/docs?upload=1`}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-5 text-[13px] font-semibold text-primary-fg shadow-soft-sm hover:bg-primary-hover"
            >
              <Icon name="upload" size={14} />
              {t("welcomeUpload")}
            </Link>
            <Link
              href={`/knowledge/${kb.id}/docs?ingestUrl=1`}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-5 text-[13px] text-text hover:border-border-strong"
            >
              <Icon name="link" size={14} />
              {t("welcomeIngestUrl")}
            </Link>
          </div>
          <p className="mt-4 font-mono text-[11px] text-text-subtle">
            {t("welcomeFootnote")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        {/* Hero strip */}
        <div className="rounded-xl border border-border bg-surface px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-text-subtle">
                {t("descriptionLabel")}
              </div>
              <p className="mt-1 text-[14px] leading-relaxed text-text">
                {kb.description || t("noDescription")}
              </p>
            </div>
            <Link
              href={`/knowledge/${kb.id}/settings`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-2 px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
            >
              <Icon name="edit" size={11} />
              {t("editDescription")}
            </Link>
          </div>
        </div>

        {/* Health */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-mono uppercase tracking-wider text-text-subtle">
              {t("healthLabel")}
            </div>
            {health?.last_activity && (
              <span className="font-mono text-[10px] text-text-subtle">
                {t("lastActive", { when: formatRelativeTime(new Date(health.last_activity)) })}
              </span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <KpiCell
              label={t("docs")}
              value={kb.document_count.toString()}
            />
            <KpiCell
              label={t("chunks")}
              value={formatCompact(kb.chunk_count)}
            />
            <KpiCell
              label={t("tokens")}
              value={health ? formatCompact(health.token_sum) : "—"}
            />
          </div>
          <div className="mt-3">
            <div className="font-mono text-[10px] text-text-subtle">
              {t("activity30d")}
            </div>
            <Sparkline data={sparkline.map((d) => d.count)} />
          </div>
          {(health?.top_tags ?? []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(health?.top_tags ?? []).map((tg) => (
                <Link
                  key={tg.tag}
                  href={`/knowledge/${kb.id}/docs?tag=${encodeURIComponent(tg.tag)}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-muted hover:border-primary/40 hover:text-primary"
                >
                  #{tg.tag}
                  <span className="text-text-subtle">·{tg.count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent + Starter questions */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="text-[11px] font-mono uppercase tracking-wider text-text-subtle">
              {t("recentUploads")}
            </div>
            {!recent ? (
              <ul className="mt-3 space-y-1.5">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                    <SkeletonRow width="70%" />
                  </li>
                ))}
              </ul>
            ) : recent.length === 0 ? (
              <p className="mt-3 text-[12px] text-text-muted">
                {t("emptyDocs")}
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {recent.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/knowledge/${kb.id}/docs/${d.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-transparent bg-surface-2 px-3 py-2 text-[12px] hover:border-primary/40"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon
                          name="file-text"
                          size={11}
                          className="shrink-0 text-text-subtle"
                        />
                        <span className="truncate text-text">{d.title}</span>
                      </span>
                      <StateBadge state={d.state} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/knowledge/${kb.id}/docs`}
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {t("seeAllDocs")}
              <Icon name="arrow-right" size={11} />
            </Link>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="text-[11px] font-mono uppercase tracking-wider text-text-subtle">
              {tStarter("label")}
            </div>
            {starters === null ? (
              <ul className="mt-3 space-y-1.5">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                    <SkeletonRow width="85%" />
                  </li>
                ))}
              </ul>
            ) : starters.length === 0 ? (
              <p className="mt-3 text-[12px] text-text-muted">
                {t("noStarters")}
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {starters.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/knowledge/${kb.id}/ask?q=${encodeURIComponent(q)}`,
                        )
                      }
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-[12px] text-text hover:border-primary/40 hover:bg-primary-muted/30"
                    >
                      <Icon
                        name="sparkles"
                        size={11}
                        className="text-primary"
                      />
                      <span className="flex-1">{q}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-subtle">
            {t("quickActions")}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/knowledge/${kb.id}/docs?upload=1`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover"
            >
              <Icon name="upload" size={13} />
              {t("upload")}
            </Link>
            <Link
              href={`/knowledge/${kb.id}/docs?ingestUrl=1`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 text-[12px] text-text hover:border-border-strong"
            >
              <Icon name="link" size={13} />
              {t("ingestUrl")}
            </Link>
            <Link
              href={`/knowledge/${kb.id}/ask`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 text-[12px] text-text hover:border-border-strong"
            >
              <Icon name="sparkles" size={13} />
              {t("ask")}
            </Link>
            <Link
              href={`/knowledge/${kb.id}/search`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 text-[12px] text-text hover:border-border-strong"
            >
              <Icon name="search" size={13} />
              {t("search")}
            </Link>
            <Link
              href={`/knowledge/${kb.id}/settings`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 text-[12px] text-text hover:border-border-strong"
            >
              <Icon name="settings" size={13} />
              {t("settings")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const cls =
    state === "ready"
      ? "border-success/30 bg-success-soft text-success"
      : state === "failed"
        ? "border-danger/30 bg-danger-soft text-danger"
        : "border-warning/30 bg-warning-soft text-warning";
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2 font-mono text-[9px] uppercase tracking-wide ${cls}`}
    >
      {state}
    </span>
  );
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-text-subtle">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[16px] font-semibold text-text">
        {value}
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const W = 100;
  const H = 28;
  const safe = data.length > 0 ? data : new Array(30).fill(0);
  const max = Math.max(1, ...safe);
  const barW = W / Math.max(1, safe.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-1 h-8 w-full"
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
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return d.toISOString().slice(0, 10);
}
