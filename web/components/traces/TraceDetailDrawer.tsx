"use client";

import type { TraceSummaryDto } from "@/lib/observatory-api";

function formatDuration(s: number | null): string {
  if (s === null || s === undefined) return "—";
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  return `${s.toFixed(2)}s`;
}

function formatStartedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN");
}

export function buildLangfuseUrl(
  host: string | null | undefined,
  traceId: string,
): string | null {
  if (!host) return null;
  const trimmed = host.replace(/\/$/, "");
  return `${trimmed}/trace/${encodeURIComponent(traceId)}`;
}

export function TraceDetailDrawer({
  trace,
  langfuseHost,
  onClose,
}: {
  trace: TraceSummaryDto;
  langfuseHost: string | null;
  onClose: () => void;
}) {
  const langfuseUrl = buildLangfuseUrl(langfuseHost, trace.trace_id);
  const failed = trace.status === "failed";

  return (
    <aside
      role="dialog"
      aria-label={`Trace ${trace.trace_id} 详情`}
      className="flex h-full w-[420px] shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            trace
          </div>
          <div className="truncate font-mono text-[12px] text-text">
            {trace.trace_id}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border font-mono text-[11px] text-text-muted transition-colors duration-base hover:text-text hover:border-border-strong"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <dl className="grid grid-cols-[88px_1fr] gap-x-4 gap-y-2 px-4 py-4 text-[12px]">
          <Row label="状态">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  failed ? "bg-danger" : "bg-success"
                }`}
              />
              <span className={failed ? "text-danger" : "text-text"}>
                {failed ? "失败" : "成功"}
              </span>
            </span>
          </Row>
          <Row label="员工">
            <span className="text-text">
              {trace.employee_name ?? trace.employee_id ?? "—"}
            </span>
            {trace.employee_id ? (
              <span className="ml-2 font-mono text-[10px] text-text-subtle">
                {trace.employee_id}
              </span>
            ) : null}
          </Row>
          <Row label="开始时间">
            <span className="font-mono text-[11px] text-text">
              {formatStartedAt(trace.started_at)}
            </span>
          </Row>
          <Row label="时长">
            <span className="font-mono text-[11px] tabular-nums text-text">
              {formatDuration(trace.duration_s)}
            </span>
          </Row>
          <Row label="tokens">
            <span className="font-mono text-[11px] tabular-nums text-text">
              {trace.tokens.toLocaleString()}
            </span>
          </Row>
        </dl>

        <section className="border-t border-border px-4 py-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            Steps
          </div>
          <p className="mt-2 text-[12px] text-text-muted">
            完整 step / input / output 链路保存在 Langfuse 上 ·
            点击下方外链跳转查看。
          </p>
        </section>

        <section className="border-t border-border px-4 py-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            Langfuse
          </div>
          {langfuseUrl ? (
            <a
              href={langfuseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[12px] text-primary transition-colors duration-base hover:underline"
            >
              在 Langfuse 中查看完整 trace
              <span aria-hidden className="font-mono text-[11px]">
                ↗
              </span>
            </a>
          ) : (
            <p className="mt-2 text-[12px] text-text-muted">
              Langfuse 未连接 ·
              在「观测中心」配置后,这里会出现外链。
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-text-subtle pt-0.5">
        {label}
      </dt>
      <dd className="text-text-muted">{children}</dd>
    </>
  );
}
