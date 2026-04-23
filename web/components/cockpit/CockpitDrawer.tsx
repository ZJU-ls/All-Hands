"use client";

/**
 * Right-edge drawer hosting the cockpit's secondary observation panels
 * (Health · Budget · Recent Conversations). Separate file so the whole
 * module graph — icons, Sparkline, date utilities — is dynamic-imported
 * by `DrawerRail.tsx` and doesn't enter the cockpit route's cold-compile
 * graph until the user first opens a drawer (L08).
 *
 * Panels mirror existing sub-components' semantics but expand the data
 * density: Health shows per-component detail with a ping description;
 * Budget shows an in/out split meter + 24h cost; Convs reuses the list
 * inline (cheap enough to duplicate rather than share and share the load
 * of a router jump).
 */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Sparkline } from "@/components/ui/Sparkline";
import type {
  ComponentStatusDto,
  ComponentStatusKind,
  ConvCardDto,
  HealthSnapshotDto,
  WorkspaceSummaryDto,
} from "@/lib/cockpit-api";

export type DrawerPanel = "health" | "budget" | "convs";

const TITLES: Record<DrawerPanel, string> = {
  health: "系统健康",
  budget: "今日消耗",
  convs: "最近对话",
};

function statusDot(kind: ComponentStatusKind): string {
  if (kind === "ok") return "bg-success";
  if (kind === "degraded") return "bg-warning";
  return "bg-danger";
}

function statusText(kind: ComponentStatusKind): string {
  if (kind === "ok") return "OK";
  if (kind === "degraded") return "DEGRADED";
  return "DOWN";
}

function kFormat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function HealthRow({
  label,
  comp,
}: {
  label: string;
  comp: ComponentStatusDto;
}) {
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${statusDot(comp.status)}`}
          style={
            comp.status === "ok"
              ? undefined
              : { animation: "ah-dot 1600ms ease-in-out infinite" }
          }
        />
        <span className="text-[12px] text-text">{label}</span>
      </div>
      <div className="flex flex-col items-end min-w-0">
        <span
          className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${
            comp.status === "ok"
              ? "text-success"
              : comp.status === "degraded"
                ? "text-warning"
                : "text-danger"
          }`}
        >
          {statusText(comp.status)}
        </span>
        {comp.detail && (
          <span className="mt-0.5 font-mono text-[10px] text-text-subtle truncate max-w-[200px] text-right">
            {comp.detail}
          </span>
        )}
      </div>
    </li>
  );
}

function HealthPanelBody({ health }: { health: HealthSnapshotDto }) {
  const entries: { key: keyof HealthSnapshotDto; label: string }[] = [
    { key: "gateway", label: "模型网关" },
    { key: "mcp_servers", label: "MCP 服务器" },
    { key: "langfuse", label: "Langfuse" },
    { key: "db", label: "数据库" },
    { key: "triggers", label: "触发器调度" },
  ];
  return (
    <ul>
      {entries.map((e) => (
        <HealthRow key={e.key} label={e.label} comp={health[e.key]} />
      ))}
    </ul>
  );
}

function BudgetPanelBody({ summary }: { summary: WorkspaceSummaryDto }) {
  const total = summary.tokens_today_total;
  const promptPct =
    total > 0 ? Math.round((summary.tokens_today_prompt / total) * 100) : 0;
  const costPerK =
    total > 0
      ? (summary.estimated_cost_today_usd / total) * 1000
      : 0;
  return (
    <div className="p-4 space-y-5">
      <div>
        <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          估算成本 · 24h
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[28px] font-semibold tabular-nums leading-none text-text">
            ${summary.estimated_cost_today_usd.toFixed(2)}
          </span>
          <span className="font-mono text-[10px] text-text-subtle">USD</span>
        </div>
        {costPerK > 0 && (
          <div className="mt-1 font-mono text-[10px] text-text-subtle tabular-nums">
            ≈ ${costPerK.toFixed(4)} / 1k tokens
          </div>
        )}
      </div>
      <div>
        <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          Tokens · 24h
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-[22px] font-semibold tabular-nums leading-none text-text">
            {kFormat(total)}
          </span>
          <span className="font-mono text-[10px] text-text-subtle">total</span>
        </div>
        {total > 0 && (
          <>
            <div
              className="mt-3 h-1.5 rounded-sm bg-surface-2 overflow-hidden"
              aria-label="prompt vs completion split"
            >
              <div
                className="h-full bg-primary"
                style={{ width: `${promptPct}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-text-subtle tabular-nums">
              <span>
                <span className="text-text">prompt</span> {kFormat(summary.tokens_today_prompt)}
              </span>
              <span>
                <span className="text-text">out</span> {kFormat(summary.tokens_today_completion)}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-border bg-surface px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            活跃 run
          </div>
          <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-text">
            {summary.runs_active}
          </div>
        </div>
        <div className="rounded border border-border bg-surface px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            对话 · 24h
          </div>
          <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-text">
            {summary.conversations_today}
          </div>
        </div>
      </div>
      <div className="text-primary">
        <Sparkline
          values={[0.1, 0.3, 0.2, 0.6, 0.5, 0.8, promptPct / 100 || 0.1]}
          height={32}
          strokeWidth={1.25}
          ariaLabel="cost trend · 24h"
        />
      </div>
    </div>
  );
}

function ConvsPanelBody({ conversations }: { conversations: ConvCardDto[] }) {
  if (conversations.length === 0) {
    return (
      <div className="p-6 text-[12px] text-text-muted text-center">
        还没有对话 · 去{" "}
        <Link href="/chat" className="text-primary hover:underline">
          /chat
        </Link>{" "}
        起一段
      </div>
    );
  }
  return (
    <>
      <ul>
        {conversations.map((c) => (
          <li
            key={c.id}
            className="border-b border-border last:border-b-0"
          >
            <Link
              href={`/chat/${c.id}`}
              className="block px-3 py-2.5 hover:bg-surface-2 transition-colors duration-base"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-text truncate">
                  {c.title || "(无标题)"}
                </span>
                <time className="font-mono text-[10px] text-text-subtle shrink-0 tabular-nums">
                  {shortDate(c.updated_at)}
                </time>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] text-text-subtle">
                <span className="truncate">{c.employee_name}</span>
                <span className="tabular-nums">{c.message_count} 条</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-2.5">
        <Link
          href="/conversations"
          className="block text-center font-mono text-[11px] text-text-muted hover:text-text transition-colors duration-base"
        >
          查看全部 →
        </Link>
      </div>
    </>
  );
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return `${String(d.getHours()).padStart(2, "0")}:${String(
        d.getMinutes(),
      ).padStart(2, "0")}`;
    }
    return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

export function CockpitDrawer({
  panel,
  summary,
  onClose,
}: {
  panel: DrawerPanel;
  summary: WorkspaceSummaryDto;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // ESC closes. Focus the drawer on mount so ESC routes to us before any
  // bubbling keyboard handler elsewhere steals it.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label={TITLES[panel]}
      tabIndex={-1}
      data-testid={`cockpit-drawer-${panel}`}
      className="absolute top-0 bottom-0 right-11 z-20 w-80 border-l border-r border-border bg-surface outline-none flex flex-col"
      style={{ animation: "ah-fade-up 180ms var(--ease-out) both" }}
    >
      <header className="flex items-center justify-between h-10 px-3 border-b border-border shrink-0">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          {TITLES[panel]}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-text-muted hover:text-text hover:border-border-strong hover:bg-surface-2 transition-colors duration-base"
          aria-label="关闭"
          data-testid="cockpit-drawer-close"
        >
          <span aria-hidden="true" className="font-mono text-[12px] leading-none">
            ×
          </span>
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {panel === "health" && <HealthPanelBody health={summary.health} />}
        {panel === "budget" && <BudgetPanelBody summary={summary} />}
        {panel === "convs" && (
          <ConvsPanelBody conversations={summary.recent_conversations} />
        )}
      </div>
    </div>
  );
}
