"use client";

import Link from "next/link";
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

export function ActivityFeed({
  events,
  emptyHint = "暂无活动",
}: {
  events: ActivityEventDto[];
  emptyHint?: string;
}) {
  return (
    <section className="flex flex-col min-h-0 h-full">
      <header className="flex items-center justify-between h-8 px-3 border-b border-border shrink-0">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          活动流
        </span>
        <span className="font-mono text-[10px] text-text-subtle">
          {events.length} 条
        </span>
      </header>
      {events.length === 0 ? (
        <p className="flex-1 flex items-center justify-center text-[12px] text-text-muted">
          {emptyHint}
        </p>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {events.map((e) => {
            const bar = severityBarClass(e.severity);
            const body = (
              <div className="relative pl-3 pr-3 py-2 hover:bg-surface-2 transition-colors duration-base">
                <span
                  className={`absolute left-0 top-2 bottom-2 w-[2px] ${bar}`}
                  aria-hidden="true"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-text-subtle truncate">
                    {e.kind}
                  </span>
                  <span
                    className="font-mono text-[10px] text-text-subtle shrink-0"
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
