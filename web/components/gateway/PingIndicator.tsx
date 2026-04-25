"use client";

/**
 * PingIndicator · /gateway connectivity state (ADR 0016 · V2 · 2-layer rewrite).
 *
 * 第一性原理: "连通" 不是单一布尔。把它拆成两个独立维度,独立显示 ——
 *
 *   端点 (Endpoint)  → 这把 key + base_url 能不能触达 provider
 *                       (GET /v1/models · 不调推理)
 *   模型 (Model)     → 这条 (provider, model) 能不能跑一次最小 chat
 *                       (max_tokens=1 · 白名单分类)
 *
 * 视觉契约:
 *   idle    → 6px neutral dot 占位(行尾活动图标已暗示"点击测试",一颗
 *             "待测" 占位 pill 在每行重复是视觉噪音)
 *   running → "测试中" 单 pill (primary-soft + animate-pulse-ring)
 *   ok/fail → 两个 pill 并排 · `EP {状态}` + `M {状态}`
 *             颜色独立:每层各自 success / warning / danger,所以一眼就能
 *             区分 "端点挂了" / "认证错" / "模型不在" / "连通但慢"。
 *   legacy  → 旧 ok/fail 单 pill 形态保留兼容(e2e mock 仍发旧格式)。
 *
 * 所有 wrapper 高度对齐 h-6,行不会因状态切换发生 reflow。
 */

import { Icon, type IconName } from "@/components/ui/icon";

export type EndpointPart = {
  reachable: boolean;
  authOk: boolean | null;
  statusCode: number | null;
  latencyMs: number;
  errorKind:
    | "ok"
    | "network"
    | "timeout"
    | "auth"
    | "not_found"
    | "server_error"
    | "unknown";
  error?: string | null;
};

export type ModelPart = {
  usable: boolean;
  classification:
    | "ok"
    | "auth"
    | "model_not_found"
    | "network"
    | "timeout"
    | "rate_limit"
    | "provider_error"
    | "param_error"
    | "unknown";
  statusCode: number | null;
  latencyMs: number;
  error?: string | null;
};

export type PingState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "done";
      // Overall server-side status: ok | degraded | endpoint_unreachable |
      //   auth_failed | model_unavailable
      overall:
        | "ok"
        | "degraded"
        | "endpoint_unreachable"
        | "auth_failed"
        | "model_unavailable";
      endpoint: EndpointPart;
      model: ModelPart;
    }
  // Legacy 单态 (`fail` / `ok`) — 兼容旧调用点;新 ping 接口走 `done`.
  | { status: "ok"; latencyMs: number }
  | { status: "fail"; category: string; error: string; latencyMs: number };

const ENDPOINT_LABEL: Record<EndpointPart["errorKind"], string> = {
  ok: "端点 OK",
  network: "端点不通",
  timeout: "端点超时",
  auth: "认证失败",
  not_found: "端点路径错",
  server_error: "供应商故障",
  unknown: "端点异常",
};

const MODEL_LABEL: Record<ModelPart["classification"], string> = {
  ok: "模型 OK",
  auth: "认证失败",
  model_not_found: "模型不存在",
  network: "网络不通",
  timeout: "模型超时",
  rate_limit: "限流",
  provider_error: "供应商错",
  param_error: "参数错",
  unknown: "模型异常",
};

const LEGACY_CATEGORY_LABEL: Record<string, string> = {
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
  "inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-mono tabular-nums";

const SLOW_THRESHOLD_MS = 5_000;

function endpointTone(e: EndpointPart): "success" | "warning" | "danger" {
  if (e.errorKind === "ok") return "success";
  if (e.errorKind === "auth") return "danger";
  if (
    e.errorKind === "network" ||
    e.errorKind === "timeout" ||
    e.errorKind === "unknown"
  )
    return "danger";
  // server_error / not_found → reachable but odd
  return "warning";
}

function modelTone(m: ModelPart): "success" | "warning" | "danger" {
  if (!m.usable) return "danger";
  if (
    m.classification === "rate_limit" ||
    m.classification === "provider_error" ||
    m.classification === "param_error" ||
    m.latencyMs > SLOW_THRESHOLD_MS
  )
    return "warning";
  return "success";
}

const TONE_CLASS: Record<"success" | "warning" | "danger", string> = {
  success: "border-success/25 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
};

const TONE_ICON: Record<"success" | "warning" | "danger", IconName> = {
  success: "check-circle-2",
  warning: "alert-triangle",
  danger: "alert-circle",
};

function fmt(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function PingIndicator({ state }: { state: PingState }) {
  if (state.status === "idle") {
    return (
      <span
        data-ping-state="idle"
        aria-label="未测试 · 点右侧测试按钮"
        title="未测试"
        className="inline-flex h-6 w-6 items-center justify-center"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-text-subtle/50"
        />
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

  if (state.status === "fail") {
    const label =
      LEGACY_CATEGORY_LABEL[state.category] ?? LEGACY_CATEGORY_LABEL.unknown;
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

  // status === "done" — 双 pill 渲染
  const eTone = endpointTone(state.endpoint);
  const mTone = modelTone(state.model);
  const eLabel = ENDPOINT_LABEL[state.endpoint.errorKind];
  const mLabel = MODEL_LABEL[state.model.classification];

  // Tooltip 把整段诊断信息塞进去 — 用户 hover 任意 pill 都能看到
  const tooltip =
    `端点: ${eLabel}` +
    (state.endpoint.statusCode != null ? ` (HTTP ${state.endpoint.statusCode})` : "") +
    ` · ${fmt(state.endpoint.latencyMs)}` +
    (state.endpoint.error ? `\n${state.endpoint.error}` : "") +
    `\n模型: ${mLabel}` +
    (state.model.statusCode != null ? ` (HTTP ${state.model.statusCode})` : "") +
    ` · ${fmt(state.model.latencyMs)}` +
    (state.model.error ? `\n${state.model.error}` : "");

  return (
    <span
      data-ping-state="done"
      data-ping-overall={state.overall}
      title={tooltip}
      aria-label={`${eLabel} · ${mLabel}`}
      className="inline-flex items-center gap-1.5"
    >
      <span
        data-ping-layer="endpoint"
        className={`${BASE_PILL} ${TONE_CLASS[eTone]}`}
      >
        <Icon name={TONE_ICON[eTone]} size={11} strokeWidth={2} />
        <span className="opacity-60">EP</span>
        <span>
          {state.endpoint.errorKind === "ok"
            ? fmt(state.endpoint.latencyMs)
            : eLabel}
        </span>
      </span>
      <span
        data-ping-layer="model"
        className={`${BASE_PILL} ${TONE_CLASS[mTone]}`}
      >
        <Icon name={TONE_ICON[mTone]} size={11} strokeWidth={2} />
        <span className="opacity-60">M</span>
        <span>
          {state.model.usable && state.model.classification === "ok"
            ? fmt(state.model.latencyMs)
            : mLabel}
        </span>
      </span>
    </span>
  );
}
