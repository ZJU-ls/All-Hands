"use client";

import Link from "next/link";
import type { ActiveRunCardDto } from "@/lib/cockpit-api";
import { TraceChip } from "@/components/runs/TraceChip";

const STATUS_LABEL: Record<ActiveRunCardDto["status"], string> = {
  thinking: "思考",
  calling_tool: "调工具",
  waiting_confirmation: "等确认",
  writing: "输出",
};

export function ActiveRunsList({ runs }: { runs: ActiveRunCardDto[] }) {
  return (
    <section className="flex flex-col min-h-0">
      <header className="flex items-center justify-between h-8 px-3 border-b border-border">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          正在执行
        </span>
        <span className="font-mono text-[10px] text-text-subtle">{runs.length} 个</span>
      </header>
      {runs.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-text-muted">
          没有正在执行的 run · 空手套白狼
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((r) => (
            <li key={r.run_id}>
              <Link
                href={`/chat?run=${r.run_id}`}
                className="block px-3 py-2 hover:bg-surface-2 transition-colors duration-base"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[12px] font-medium text-text truncate">
                      {r.employee_name}
                    </span>
                    <span
                      className={
                        r.status === "waiting_confirmation"
                          ? "font-mono text-[10px] uppercase tracking-wider text-warning"
                          : "font-mono text-[10px] uppercase tracking-wider text-text-subtle"
                      }
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <TraceChip runId={r.run_id} variant="link" />
                    <span className="font-mono text-[10px] text-text-subtle tabular-nums">
                      {r.iteration} / {r.max_iterations}
                    </span>
                  </div>
                </div>
                <p className="mt-0.5 text-[12px] text-text-muted truncate">
                  {r.current_action_summary || "—"}
                </p>
                {r.depth > 0 && (
                  <p className="mt-0.5 font-mono text-[10px] text-text-subtle">
                    depth {r.depth}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
