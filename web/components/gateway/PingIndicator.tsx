"use client";

/**
 * PingIndicator · /gateway model row connectivity state (ADR 0016 · V2 polish).
 *
 * A compact `h-6 px-2 rounded-full text-caption font-mono` pill with four
 * states. Uses the design-system token palette (no raw tailwind colors) and
 * a Lucide icon glyph through the `<Icon>` wrapper.
 *
 *   idle     → surface-2 pill · subtle dot
 *   running  → primary-soft pill · `animate-pulse-ring` dot · "测试中"
 *   ok       → success-soft pill · check-circle-2 · "{latency}ms"
 *   fail     → danger-soft pill · alert-circle · "{category}" · hover=full err
 */

import { Icon } from "@/components/ui/icon";

export type PingState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; latencyMs: number }
  | { status: "fail"; category: string; error: string; latencyMs: number };

const CATEGORY_LABEL: Record<string, string> = {
  timeout: "超时",
  auth: "认证失败",
  rate_limit: "限流",
  model_not_found: "模型不存在",
  connection: "网络不通",
  context_length: "上下文超限",
  provider_error: "供应商错误",
  unknown: "失败",
};

const BASE_PILL =
  "inline-flex items-center gap-1.5 h-6 px-2 rounded-full border text-[11px] font-mono tabular-nums";

export function PingIndicator({ state }: { state: PingState }) {
  if (state.status === "idle") {
    return (
      <span
        data-ping-state="idle"
        aria-label="未测试"
        className={`${BASE_PILL} border-border bg-surface-2 text-text-subtle`}
      >
        <span
          aria-hidden="true"
          className="inline-block w-[6px] h-[6px] rounded-full bg-text-subtle/60"
        />
        <span>待测</span>
      </span>
    );
  }

  if (state.status === "running") {
    return (
      <span
        data-ping-state="running"
        role="status"
        aria-live="polite"
        className={`${BASE_PILL} border-primary/25 bg-primary/10 text-primary`}
      >
        <span
          aria-hidden="true"
          className="inline-block w-[6px] h-[6px] rounded-full bg-primary animate-pulse-ring"
        />
        <span>测试中</span>
      </span>
    );
  }

  if (state.status === "ok") {
    return (
      <span
        data-ping-state="ok"
        aria-label={`连通 · ${state.latencyMs}ms`}
        className={`${BASE_PILL} border-success/25 bg-success-soft text-success`}
      >
        <Icon name="check-circle-2" size={11} strokeWidth={2} />
        <span>{state.latencyMs}ms</span>
      </span>
    );
  }

  const label = CATEGORY_LABEL[state.category] ?? CATEGORY_LABEL.unknown;
  return (
    <span
      data-ping-state="fail"
      title={state.error}
      aria-label={`失败 · ${label} · ${state.error}`}
      className={`${BASE_PILL} border-danger/30 bg-danger-soft text-danger`}
    >
      <Icon name="alert-circle" size={11} strokeWidth={2} />
      <span>{label}</span>
    </span>
  );
}
