"use client";

/**
 * PingIndicator · /gateway model 行的连通性状态机(I-0019)
 *
 * 四态 · token 色 · 无 icon 库:
 *   idle     → 7px 灰静点(bg-border)
 *   running  → 7px spinner + "测试中" 提示
 *   ok       → 7px success 脉动点 + "✓ {latency}ms" mono
 *   fail     → 7px danger 静点 + "✗ {error_category}" mono · hover=完整 error
 */

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

export function PingIndicator({ state }: { state: PingState }) {
  if (state.status === "idle") {
    return (
      <span
        data-ping-state="idle"
        className="inline-flex items-center"
        aria-label="未测试"
      >
        <span
          aria-hidden="true"
          className="inline-block w-[7px] h-[7px] rounded-full bg-border"
        />
      </span>
    );
  }

  if (state.status === "running") {
    return (
      <span
        data-ping-state="running"
        className="inline-flex items-center gap-1.5 text-text-muted"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="inline-block w-[7px] h-[7px] rounded-full border-[1.5px]"
          style={{
            borderColor: "color-mix(in srgb, currentColor 25%, transparent)",
            borderTopColor: "currentColor",
            animation: "ah-spin 700ms linear infinite",
          }}
        />
        <span className="font-mono text-[11px]">测试中</span>
      </span>
    );
  }

  if (state.status === "ok") {
    return (
      <span
        data-ping-state="ok"
        className="inline-flex items-center gap-1.5 text-success"
      >
        <span
          aria-hidden="true"
          className="inline-block w-[7px] h-[7px] rounded-full bg-success"
          style={{ animation: "ah-pulse 1.6s ease-in-out infinite" }}
        />
        <span className="font-mono text-[11px]">
          ✓ {state.latencyMs}ms
        </span>
      </span>
    );
  }

  const label = CATEGORY_LABEL[state.category] ?? CATEGORY_LABEL.unknown;
  return (
    <span
      data-ping-state="fail"
      className="inline-flex items-center gap-1.5 text-danger"
      title={state.error}
    >
      <span
        aria-hidden="true"
        className="inline-block w-[7px] h-[7px] rounded-full bg-danger"
      />
      <span className="font-mono text-[11px]">
        ✗ {label}
      </span>
    </span>
  );
}
