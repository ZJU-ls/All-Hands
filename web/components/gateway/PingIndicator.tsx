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

  // status === "done" — two pills
  const eTone = endpointTone(state.endpoint);
  const mTone = modelTone(state.model);
  const eLabel = t(ENDPOINT_KEYS[state.endpoint.errorKind]);
  const mLabel = t(MODEL_KEYS[state.model.classification]);

  const tooltip = t("doneTooltip", {
    endpoint: eLabel,
    endpointStatus:
      state.endpoint.statusCode != null ? ` (HTTP ${state.endpoint.statusCode})` : "",
    endpointLatency: fmt(state.endpoint.latencyMs),
    endpointError: state.endpoint.error ? `\n${state.endpoint.error}` : "",
    model: mLabel,
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
      aria-label={t("doneAria", { endpoint: eLabel, model: mLabel })}
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
