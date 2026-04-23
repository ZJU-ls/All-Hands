"use client";

/**
 * ActivityFeed · "Flight recorder" tail of the workspace (V2 Azure Live).
 *
 * Restyle: each row is a compact entry — an icon tile on the left carrying
 * the kind-glyph + severity color, middle column has the summary + kind
 * chip + optional actor, right column shows a relative timestamp + a small
 * status dot. The shell is a `rounded-xl` card with a header pill.
 *
 * Behaviour / props unchanged; icons via `<Icon>` (ADR 0016 §D1).
 */

import Link from "next/link";
import { EmptyState } from "@/components/state";
import { Icon, type IconName } from "@/components/ui/icon";
import type { ActivityEventDto } from "@/lib/cockpit-api";

function severityIconTile(severity: ActivityEventDto["severity"]): {
  bg: string;
  fg: string;
  dot: string;
} {
  if (severity === "error")
    return { bg: "bg-danger-soft", fg: "text-danger", dot: "bg-danger" };
  if (severity === "warn")
    return { bg: "bg-warning-soft", fg: "text-warning", dot: "bg-warning" };
  return { bg: "bg-primary-muted", fg: "text-primary", dot: "bg-success" };
}

/** Pick a lucide glyph by kind prefix. Kind strings follow `domain.action`
 * conventions; fall back to `activity` for unknowns so we never crash. */
function iconForKind(kind: string, severity: ActivityEventDto["severity"]): IconName {
  if (severity === "error") return "alert-circle";
  if (severity === "warn") return "alert-triangle";
  if (kind.startsWith("run.")) return "play-circle";
  if (kind.startsWith("tool.")) return "terminal";
  if (kind.startsWith("conv.") || kind.startsWith("message."))
    return "message-square";
  if (kind.startsWith("confirm")) return "shield-check";
  if (kind.startsWith("trigger")) return "zap";
  if (kind.startsWith("artifact")) return "file";
  return "activity";
}

function timeAgo(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const secs = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function ActivityFeed({
  events,
  emptyTitle = "等待首条事件",
}: {
  events: ActivityEventDto[];
  emptyTitle?: string;
}) {
  return (
    <section className="flex flex-col min-h-0 h-full rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden">
      <header className="flex items-center justify-between h-10 px-4 border-b border-border shrink-0 bg-surface-2/60">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary-muted text-primary">
            <Icon name="activity" size={12} strokeWidth={2} />
          </span>
          <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text">
            活动流 · 飞行记录
          </span>
        </span>
        <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-surface-3 font-mono text-[10px] tabular-nums text-text-muted">
          {events.length.toString().padStart(3, "0")} EV
        </span>
      </header>
      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <EmptyState title={emptyTitle} />
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-border">
          {events.map((e) => {
            const tile = severityIconTile(e.severity);
            const glyph = iconForKind(e.kind, e.severity);
            const body = (
              <div className="flex items-start gap-3 px-4 py-3 transition-colors duration-base hover:bg-surface-2">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tile.bg} ${tile.fg}`}
                >
                  <Icon name={glyph} size={14} strokeWidth={2} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="flex-1 text-sm text-text break-words line-clamp-2">
                      {e.summary}
                    </p>
                    <time
                      className="font-mono text-caption text-text-subtle shrink-0 tabular-nums"
                      title={e.ts}
                    >
                      {timeAgo(e.ts)}
                    </time>
                  </div>
                  <div className="mt-1 flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${tile.dot}`}
                    />
                    <span className="font-mono text-caption text-text-muted truncate">
                      {e.kind}
                    </span>
                    {e.actor && (
                      <>
                        <span
                          aria-hidden="true"
                          className="font-mono text-[10px] text-text-subtle"
                        >
                          ·
                        </span>
                        <span className="font-mono text-caption text-text-subtle truncate">
                          {e.actor}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
            return (
              <li key={e.id}>
                {e.link ? (
                  <Link href={e.link} className="block">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
