"use client";

/**
 * ActiveRunsList · "Flight strip" of runs currently in-flight.
 *
 * Card-ish rows with:
 *  · left-edge 2px primary hairline (allowed accent, §3.8 §10.3)
 *  · mono sequence number (001…) for flight-recorder feel
 *  · status pulse dot using the `ah-dot` keyframe (allowed animation)
 *  · iteration progress bar
 *  · depth marker for subagent runs
 *
 * No new icons, no scale, no glow. Status color is carried by the dot,
 * not the background — keeps color density under §3.8 cap of 3.
 */

import Link from "next/link";
import type { ActiveRunCardDto, ActiveRunStatus } from "@/lib/cockpit-api";
import { TraceChip } from "@/components/runs/TraceChip";

const STATUS_LABEL: Record<ActiveRunStatus, string> = {
  thinking: "思考",
  calling_tool: "调工具",
  waiting_confirmation: "等确认",
  writing: "输出",
};

function statusDotClass(status: ActiveRunStatus): string {
  if (status === "waiting_confirmation") return "bg-warning";
  return "bg-primary";
}

function shouldPulse(status: ActiveRunStatus): boolean {
  return status !== "waiting_confirmation";
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function RunRow({ r, seq }: { r: ActiveRunCardDto; seq: number }) {
  const dot = statusDotClass(r.status);
  const pulse = shouldPulse(r.status);
  const iterPct = Math.max(
    0,
    Math.min(1, r.max_iterations > 0 ? r.iteration / r.max_iterations : 0),
  );
  const waiting = r.status === "waiting_confirmation";
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        href={`/chat?run=${r.run_id}`}
        className="relative block px-3 py-2.5 hover:bg-surface-2 transition-colors duration-base"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-px"
          style={{
            background:
              "linear-gradient(to bottom, var(--color-primary), transparent)",
            opacity: 0.2,
          }}
        />
        <div className="flex items-start gap-3 min-w-0">
          <span className="font-mono text-[10px] tabular-nums text-text-subtle pt-0.5 w-7 shrink-0">
            {pad3(seq)}
          </span>
          <span
            aria-hidden="true"
            className={`mt-[7px] h-1.5 w-1.5 rounded-full shrink-0 ${dot}`}
            style={
              pulse
                ? { animation: "ah-dot 1600ms ease-in-out infinite" }
                : undefined
            }
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[12px] font-medium text-text truncate">
                  {r.employee_name}
                </span>
                <span
                  className={`font-mono text-[10px] uppercase tracking-wider ${
                    waiting ? "text-warning" : "text-text-subtle"
                  }`}
                >
                  {STATUS_LABEL[r.status]}
                </span>
                {r.depth > 0 && (
                  <span className="font-mono text-[10px] text-text-subtle">
                    · depth {r.depth}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <TraceChip runId={r.run_id} variant="link" />
                <span className="font-mono text-[10px] text-text-subtle tabular-nums">
                  {r.iteration}/{r.max_iterations}
                </span>
              </div>
            </div>
            <p className="mt-0.5 text-[12px] text-text-muted truncate">
              {r.current_action_summary || "—"}
            </p>
            <div
              className="mt-1.5 h-0.5 rounded-sm bg-surface-2 overflow-hidden"
              aria-hidden="true"
            >
              <div
                className={`h-full ${waiting ? "bg-warning" : "bg-primary"}`}
                style={{ width: `${Math.round(iterPct * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

export function ActiveRunsList({ runs }: { runs: ActiveRunCardDto[] }) {
  return (
    <section className="flex flex-col min-h-0 h-full">
      <header className="flex items-center justify-between h-8 px-3 border-b border-border shrink-0">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          正在执行
        </span>
        <span className="font-mono text-[10px] text-text-subtle tabular-nums">
          {runs.length.toString().padStart(2, "0")} ACTIVE
        </span>
      </header>
      {runs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="font-mono text-[11px] text-text-muted">
            空闲 · 无进行中的 run
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {runs.map((r, idx) => (
            <RunRow key={r.run_id} r={r} seq={idx + 1} />
          ))}
        </ul>
      )}
    </section>
  );
}
