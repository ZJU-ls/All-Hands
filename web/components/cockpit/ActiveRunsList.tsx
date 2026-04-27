"use client";

/**
 * ActiveRunsList · "Flight strip" of runs currently in-flight (V2 Azure Live).
 *
 * Restyle: each row is a rich card — icon tile + employee name + rich status
 * pill + mono run id, then a one-line action summary, then a gradient
 * progress bar for iteration pacing. Waiting-for-confirmation rows get a
 * warning-tinted tile. The shell is a `rounded-xl` card with a header pill.
 *
 * Behaviour / props unchanged; icons via `<Icon>` (ADR 0016 §D1).
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import type { ActiveRunCardDto, ActiveRunStatus } from "@/lib/cockpit-api";
import { TraceChip } from "@/components/runs/TraceChip";

const STATUS_KEYS: Record<ActiveRunStatus, string> = {
  thinking: "statusThinking",
  calling_tool: "statusCallingTool",
  waiting_confirmation: "statusWaitingConfirmation",
  writing: "statusWriting",
};

type PillTone = "primary" | "warning";

function statusPill(status: ActiveRunStatus): {
  tone: PillTone;
  icon: "brain" | "terminal" | "shield-check" | "send";
} {
  switch (status) {
    case "thinking":
      return { tone: "primary", icon: "brain" };
    case "calling_tool":
      return { tone: "primary", icon: "terminal" };
    case "waiting_confirmation":
      return { tone: "warning", icon: "shield-check" };
    case "writing":
      return { tone: "primary", icon: "send" };
  }
}

function shouldPulse(status: ActiveRunStatus): boolean {
  return status !== "waiting_confirmation";
}

function shortRunId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…${id.slice(-2)}`;
}

function RunRow({ r }: { r: ActiveRunCardDto }) {
  const t = useTranslations("cockpit.activeRuns");
  const pill = statusPill(r.status);
  const pulse = shouldPulse(r.status);
  const iterPct = Math.max(
    0,
    Math.min(1, r.max_iterations > 0 ? r.iteration / r.max_iterations : 0),
  );

  const tileBg =
    pill.tone === "warning"
      ? "bg-warning-soft text-warning"
      : "bg-primary-muted text-primary";
  const pillBg =
    pill.tone === "warning"
      ? "bg-warning-soft text-warning border-warning/30"
      : "bg-primary-muted text-primary border-primary/20";
  const dot = pill.tone === "warning" ? "bg-warning" : "bg-primary";
  const barBg = pill.tone === "warning" ? "bg-warning" : "bg-primary";

  return (
    <li>
      <Link
        href={`/chat?run=${r.run_id}`}
        className="group relative block px-4 py-3 transition-colors duration-base hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tileBg}`}
          >
            <Icon name={pill.icon} size={16} strokeWidth={2} />
            <span
              aria-hidden="true"
              className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-surface ${dot}`}
              style={
                pulse
                  ? { animation: "ah-dot 1600ms ease-in-out infinite" }
                  : undefined
              }
            />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-text truncate">
                  {r.employee_name}
                </span>
                <span
                  className={`inline-flex items-center gap-1 h-5 px-2 rounded-full border font-mono text-[10px] font-semibold uppercase tracking-wider ${pillBg}`}
                >
                  {t(STATUS_KEYS[r.status])}
                </span>
                {r.depth > 0 && (
                  <span className="font-mono text-caption text-text-subtle">
                    {t("depth", { n: r.depth })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-caption tabular-nums text-text-subtle">
                  {r.iteration}/{r.max_iterations}
                </span>
                <TraceChip runId={r.run_id} variant="link" />
              </div>
            </div>
            <p className="mt-1 text-sm text-text-muted truncate">
              {r.current_action_summary || "—"}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="flex-1 h-1 rounded-full bg-surface-3 overflow-hidden"
                aria-hidden="true"
              >
                <span
                  className={`block h-full rounded-full ${barBg} transition duration-slow`}
                  style={{ width: `${Math.round(iterPct * 100)}%` }}
                />
              </span>
              <span className="font-mono text-[10px] text-text-subtle tabular-nums">
                {shortRunId(r.run_id)}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

export function ActiveRunsList({ runs }: { runs: ActiveRunCardDto[] }) {
  const t = useTranslations("cockpit.activeRuns");
  return (
    <section className="flex flex-col min-h-0 h-full rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden">
      <header className="flex items-center justify-between h-10 px-4 border-b border-border shrink-0 bg-surface-2/60">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary-muted text-primary">
            <Icon name="play-circle" size={12} strokeWidth={2} />
          </span>
          <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text">
            {t("header")}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-surface-3 font-mono text-[10px] tabular-nums text-text-muted">
          {runs.length.toString().padStart(2, "0")} {t("active")}
        </span>
      </header>
      {runs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-muted text-primary"
          >
            <Icon name="pause" size={16} strokeWidth={2} />
          </span>
          <p className="font-mono text-caption text-text-muted">
            {t("empty")}
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-border">
          {runs.map((r) => (
            <RunRow key={r.run_id} r={r} />
          ))}
        </ul>
      )}
    </section>
  );
}
