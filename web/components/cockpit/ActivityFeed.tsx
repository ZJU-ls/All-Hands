"use client";

/**
 * ActivityFeed · "Flight recorder" tail of the workspace.
 *
 * Each row gets a mono sequence number (001…) anchored to the left like
 * a cockpit voice-recorder tape, plus the existing severity color bar
 * and timestamp. The sequence descends from the newest event — row 001
 * is always the most recent.
 */

import Link from "next/link";
import { EmptyState } from "@/components/state";
import type { ActivityEventDto } from "@/lib/cockpit-api";

function severityBarClass(severity: ActivityEventDto["severity"]): string {
  if (severity === "error") return "bg-danger";
  if (severity === "warn") return "bg-warning";
  return "bg-primary";
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

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export function ActivityFeed({
  events,
  emptyTitle = "等待首条事件",
}: {
  events: ActivityEventDto[];
  emptyTitle?: string;
}) {
  return (
    <section className="flex flex-col min-h-0 h-full">
      <header className="flex items-center justify-between h-8 px-3 border-b border-border shrink-0">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          活动流 · 飞行记录
        </span>
        <span className="font-mono text-[10px] text-text-subtle tabular-nums">
          {events.length.toString().padStart(3, "0")} EV
        </span>
      </header>
      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-3">
          <EmptyState title={emptyTitle} />
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {events.map((e, idx) => {
            const bar = severityBarClass(e.severity);
            const body = (
              <div className="relative pl-10 pr-3 py-2 hover:bg-surface-2 transition-colors duration-base">
                <span
                  className={`absolute left-7 top-2 bottom-2 w-[2px] ${bar}`}
                  aria-hidden="true"
                />
                <span className="absolute left-0 top-2 font-mono text-[10px] tabular-nums text-text-subtle w-6 text-right pr-1">
                  {pad3(idx + 1)}
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-text-subtle truncate">
                    {e.kind}
                  </span>
                  <span
                    className="font-mono text-[10px] text-text-subtle shrink-0 tabular-nums"
                    title={e.ts}
                  >
                    {timeAgo(e.ts)}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-text break-words">
                  {e.summary}
                </p>
                {e.actor && (
                  <p className="mt-0.5 font-mono text-[10px] text-text-subtle truncate">
                    {e.actor}
                  </p>
                )}
              </div>
            );
            return (
              <li key={e.id} className="border-b border-border last:border-b-0">
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
