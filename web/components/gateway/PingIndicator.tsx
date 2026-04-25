"use client";

/**
 * PingIndicator · /gateway connectivity state (ADR 0016 · V2 · 2-layer rewrite).
 *
 * Two-axis "connectivity":
 *   endpoint → can the (key + base_url) reach the provider (GET /v1/models)
 *   model    → can the (provider, model) run a minimal chat (max_tokens=1)
 *
 * Visual contract:
 *   idle    → 6px neutral dot placeholder
 *   running → "testing" pill with pulse-ring
 *   ok/fail → legacy single pill (e2e mock still emits this shape)
 *   done    → endpoint pill + model pill side by side, independent tone
 */

import { useTranslations } from "next-intl";
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
      overall:
        | "ok"
        | "degraded"
        | "endpoint_unreachable"
        | "auth_failed"
        | "model_unavailable";
      endpoint: EndpointPart;
      model: ModelPart;
    }
  | { status: "ok"; latencyMs: number }
  | { status: "fail"; category: string; error: string; latencyMs: number };

const ENDPOINT_KEYS: Record<EndpointPart["errorKind"], string> = {
  ok: "endpointOk",
  network: "endpointNetwork",
  timeout: "endpointTimeout",
  auth: "endpointAuth",
  not_found: "endpointNotFound",
  server_error: "endpointServerError",
  unknown: "endpointUnknown",
};

const MODEL_KEYS: Record<ModelPart["classification"], string> = {
  ok: "modelOk",
  auth: "modelAuth",
  model_not_found: "modelNotFound",
  network: "modelNetwork",
  timeout: "modelTimeout",
  rate_limit: "modelRateLimit",
  provider_error: "modelProviderError",
  param_error: "modelParamError",
  unknown: "modelUnknown",
};

const LEGACY_CATEGORY_KEYS: Record<string, string> = {
  timeout: "categoryTimeout",
  auth: "categoryAuth",
  rate_limit: "categoryRateLimit",
  model_not_found: "categoryModelNotFound",
  connection: "categoryConnection",
  context_length: "categoryContextLength",
  provider_error: "categoryProviderError",
  unknown: "categoryUnknown",
};

const BASE_PILL =
  "inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-mono tabular-nums";

// Note (2026-04-25): the per-layer `endpointTone` / `modelTone` helpers + the
// SLOW_THRESHOLD_MS const from the dual-pill era have been retired. The
// single-pill view derives tone directly from `state.overall`, which is
// computed on the backend (see `services.connectivity.overall_status` —
// "ok" / "degraded" / "auth_failed" / "endpoint_unreachable" / "model_unavailable")
// with both layers in scope. The frontend doesn't second-guess the server's
// classification any more.

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
  const t = useTranslations("gateway.ping");

  if (state.status === "idle") {
    return (
      <span
        data-ping-state="idle"
        aria-label={t("ariaUntested")}
        title={t("labelUntested")}
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
        <span>{t("labelRunning")}</span>
      </span>
    );
  }

  if (state.status === "ok") {
    return (
      <span
        data-ping-state="ok"
        aria-label={t("ariaOk", { ms: state.latencyMs })}
        className={`${BASE_PILL} border-success/25 bg-success-soft text-success`}
      >
        <Icon name="check-circle-2" size={11} strokeWidth={2} />
        <span>{state.latencyMs}ms</span>
      </span>
    );
  }

  if (state.status === "fail") {
    const labelKey =
      LEGACY_CATEGORY_KEYS[state.category] ?? LEGACY_CATEGORY_KEYS.unknown ?? "categoryUnknown";
    const label = t(labelKey);
    return (
      <span
        data-ping-state="fail"
        title={state.error}
        aria-label={t("ariaFail", { label, error: state.error })}
        className={`${BASE_PILL} border-danger/30 bg-danger-soft text-danger`}
      >
        <Icon name="alert-circle" size={11} strokeWidth={2} />
        <span>{label}</span>
      </span>
    );
  }

  // status === "done" — single pill summarising overall reachability.
  //
  // Design rationale (2026-04-25 simplification):
  // - Default state, where everything works, was 2 pills "EP {ms} · M {ms}".
  //   `EP`/`M` are internal jargon (endpoint vs model probe layers); users
  //   only care "can I use it, how fast". Collapse to ONE pill with the
  //   model latency — that's the number that matches actual chat speed.
  // - The two-layer breakdown still has diagnostic value when something
  //   fails (was it auth? was the model name wrong? was the network bad?).
  //   So we keep it, but move it into the tooltip — visible on hover, not
  //   shouting at the user every row.
  const tone: "success" | "warning" | "danger" =
    state.overall === "ok"
      ? "success"
      : state.overall === "degraded"
        ? "warning"
        : "danger";

  const label = labelForOverall(state, t);
  const tooltip = t("doneTooltip", {
    endpoint: t(ENDPOINT_KEYS[state.endpoint.errorKind]),
    endpointStatus:
      state.endpoint.statusCode != null ? ` (HTTP ${state.endpoint.statusCode})` : "",
    endpointLatency: fmt(state.endpoint.latencyMs),
    endpointError: state.endpoint.error ? `\n${state.endpoint.error}` : "",
    model: t(MODEL_KEYS[state.model.classification]),
    modelStatus:
      state.model.statusCode != null ? ` (HTTP ${state.model.statusCode})` : "",
    modelLatency: fmt(state.model.latencyMs),
    modelError: state.model.error ? `\n${state.model.error}` : "",
  });

  return (
    <span
      data-ping-state="done"
      data-ping-overall={state.overall}
      title={tooltip}
      aria-label={label}
      className={`${BASE_PILL} ${TONE_CLASS[tone]}`}
    >
      <Icon name={TONE_ICON[tone]} size={11} strokeWidth={2} />
      <span>{label}</span>
    </span>
  );
}

/**
 * Plain-language pill text for the user-friendly single-pill view.
 *
 *   ok                    → "1.7s"          (just the time)
 *   degraded              → "9.3s 较慢"     (slow but works)
 *   auth_failed           → "凭证错误"
 *   endpoint_unreachable  → "端点不通"
 *   model_unavailable     → 具体分类 (模型不存在 / 网络不通 / 超时 / 限流 / ...)
 *
 * Single source of truth for the friendly label so the tooltip + aria-label
 * stay in sync.
 */
function labelForOverall(
  state: Extract<PingState, { status: "done" }>,
  t: (key: string) => string,
): string {
  switch (state.overall) {
    case "ok":
      return fmt(state.model.latencyMs);
    case "degraded":
      return `${fmt(state.model.latencyMs)} · ${t("labelSlow")}`;
    case "auth_failed":
      return t("categoryAuth");
    case "endpoint_unreachable":
      return t("endpointNetwork");
    case "model_unavailable":
      return t(MODEL_KEYS[state.model.classification] ?? "modelUnknown");
  }
}
