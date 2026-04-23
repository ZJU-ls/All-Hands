"use client";

/**
 * Right-edge drawer hosting the cockpit's secondary observation panels
 * (Health · Budget · Recent Conversations). Separate file so the whole
 * module graph — icons, Sparkline, date utilities — is dynamic-imported
 * by `DrawerRail.tsx` and doesn't enter the cockpit route's cold-compile
 * graph until the user first opens a drawer (L08).
 *
 * V2 Azure Live restyle (ADR 0016): drawer uses a `rounded-xl`-capped
 * right edge, a richer header (icon tile + title + close), and panel
 * bodies use token-driven soft surfaces with status tiles. Icons via
 * `<Icon>`.
 */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
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

const PANEL_ICON: Record<DrawerPanel, IconName> = {
  health: "shield-check",
  budget: "database",
  convs: "message-square",
};

function statusTone(kind: ComponentStatusKind): {
  dot: string;
  text: string;
  tile: string;
} {
  if (kind === "ok")
    return { dot: "bg-success", text: "text-success", tile: "bg-success-soft text-success" };
  if (kind === "degraded")
    return { dot: "bg-warning", text: "text-warning", tile: "bg-warning-soft text-warning" };
  return { dot: "bg-danger", text: "text-danger", tile: "bg-danger-soft text-danger" };
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
  icon,
  comp,
}: {
  label: string;
  icon: IconName;
  comp: ComponentStatusDto;
}) {
  const tone = statusTone(comp.status);
  return (
    <li className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-b-0">
      <span
        aria-hidden="true"
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.tile}`}
      >
        <Icon name={icon} size={14} strokeWidth={2} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text truncate">{label}</span>
          <span
            className={`inline-flex items-center gap-1 h-5 px-2 rounded-full font-mono text-[10px] font-semibold uppercase tracking-wider ${tone.tile}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${tone.dot}`}
              style={
                comp.status === "ok"
                  ? undefined
                  : { animation: "ah-dot 1600ms ease-in-out infinite" }
              }
            />
            {statusText(comp.status)}
          </span>
        </div>
        {comp.detail && (
          <p className="mt-0.5 font-mono text-caption text-text-subtle truncate">
            {comp.detail}
          </p>
        )}
      </div>
    </li>
  );
}

function HealthPanelBody({ health }: { health: HealthSnapshotDto }) {
  const entries: { key: keyof HealthSnapshotDto; label: string; icon: IconName }[] = [
    { key: "gateway", label: "模型网关", icon: "plug" },
    { key: "mcp_servers", label: "MCP 服务器", icon: "server" },
    { key: "langfuse", label: "Langfuse", icon: "activity" },
    { key: "db", label: "数据库", icon: "database" },
    { key: "triggers", label: "触发器调度", icon: "zap" },
  ];
  return (
    <ul>
      {entries.map((e) => (
        <HealthRow key={e.key} label={e.label} icon={e.icon} comp={health[e.key]} />
      ))}
    </ul>
  );
}

function BudgetPanelBody({ summary }: { summary: WorkspaceSummaryDto }) {
  const total = summary.tokens_today_total;
  const promptPct =
    total > 0 ? Math.round((summary.tokens_today_prompt / total) * 100) : 0;
  const costPerK =
    total > 0 ? (summary.estimated_cost_today_usd / total) * 1000 : 0;
  return (
    <div className="p-4 space-y-4">
      {/* Cost hero — gradient primary card echoing the KpiBar hero. */}
      <div
        className="relative overflow-hidden rounded-xl p-4 text-primary-fg shadow-soft-sm"
        style={{
          background:
            "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl"
          style={{ background: "var(--color-accent)", opacity: 0.4 }}
        />
        <div className="relative font-mono text-caption uppercase tracking-wider opacity-85">
          估算成本 · 24h
        </div>
        <div className="relative mt-2 flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums leading-none">
            ${summary.estimated_cost_today_usd.toFixed(2)}
          </span>
          <span className="font-mono text-caption opacity-85">USD</span>
        </div>
        {costPerK > 0 && (
          <div className="relative mt-1 font-mono text-caption opacity-85 tabular-nums">
            ≈ ${costPerK.toFixed(4)} / 1k tokens
          </div>
        )}
      </div>

      {/* Tokens split */}
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm">
        <div className="flex items-center justify-between">
          <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text-subtle">
            Tokens · 24h
          </span>
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary-muted text-primary">
            <Icon name="brain" size={12} strokeWidth={2} />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold tabular-nums leading-none text-text">
            {kFormat(total)}
          </span>
          <span className="font-mono text-caption text-text-subtle">total</span>
        </div>
        {total > 0 && (
          <>
            <div
              className="mt-3 h-1.5 rounded-full bg-surface-3 overflow-hidden"
              aria-label="prompt vs completion split"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${promptPct}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between font-mono text-caption text-text-subtle tabular-nums">
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

      {/* Secondary stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface p-3 shadow-soft-sm">
          <div className="font-mono text-caption uppercase tracking-wider text-text-subtle">
            活跃 run
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-text leading-none">
            {summary.runs_active}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3 shadow-soft-sm">
          <div className="font-mono text-caption uppercase tracking-wider text-text-subtle">
            对话 · 24h
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-text leading-none">
            {summary.conversations_today}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-primary">
        <Sparkline
          values={[0.1, 0.3, 0.2, 0.6, 0.5, 0.8, promptPct / 100 || 0.1]}
          height={32}
          strokeWidth={1.5}
          ariaLabel="cost trend · 24h"
        />
      </div>
    </div>
  );
}

function ConvsPanelBody({ conversations }: { conversations: ConvCardDto[] }) {
  if (conversations.length === 0) {
    return (
      <div className="p-6 text-center space-y-3">
        <span
          aria-hidden="true"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-muted text-primary"
        >
          <Icon name="message-square" size={18} strokeWidth={2} />
        </span>
        <p className="text-sm text-text-muted">
          还没有对话 · 去{" "}
          <Link href="/chat" className="text-primary hover:underline">
            /chat
          </Link>{" "}
          起一段
        </p>
      </div>
    );
  }
  return (
    <>
      <ul className="divide-y divide-border">
        {conversations.map((c) => (
          <li key={c.id}>
            <Link
              href={`/chat/${c.id}`}
              className="flex items-start gap-3 px-4 py-3 transition-colors duration-base hover:bg-surface-2"
            >
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary"
              >
                <Icon name="message-square" size={14} strokeWidth={2} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text truncate">
                    {c.title || "(无标题)"}
                  </span>
                  <time className="font-mono text-caption text-text-subtle shrink-0 tabular-nums">
                    {shortDate(c.updated_at)}
                  </time>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-caption text-text-subtle">
                  <span className="truncate">{c.employee_name}</span>
                  <span className="tabular-nums">{c.message_count} 条</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-3">
        <Link
          href="/conversations"
          className="flex items-center justify-center gap-1.5 rounded-lg py-2 font-mono text-caption text-text-muted transition-colors duration-base hover:text-text hover:bg-surface-2"
        >
          查看全部
          <Icon name="arrow-right" size={12} />
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
      className="absolute top-0 bottom-0 right-11 z-20 w-80 border-l border-border bg-surface shadow-soft-lg outline-none flex flex-col animate-fade-up"
    >
      <header className="flex items-center justify-between h-12 px-4 border-b border-border shrink-0 bg-surface-2/60">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-muted text-primary">
            <Icon name={PANEL_ICON[panel]} size={14} strokeWidth={2} />
          </span>
          <span className="text-sm font-semibold text-text tracking-tight">
            {TITLES[panel]}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors duration-base hover:text-text hover:bg-surface-2"
          aria-label="关闭"
          data-testid="cockpit-drawer-close"
        >
          <Icon name="x" size={14} />
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
