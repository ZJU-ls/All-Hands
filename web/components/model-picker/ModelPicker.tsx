"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand/BrandMark";
import { Icon } from "@/components/ui/icon";
import { Select, type SelectGroup, type SelectOption } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import {
  buildModelRef,
  defaultModelRef,
  listModels,
  listProviders,
  type ModelDto,
  type ProviderDto,
} from "@/lib/api";

/**
 * Compose the chip trigger className for the loading / error fallbacks.
 * Mirrors the chip shape `ModelOverrideChip` builds, so the placeholder
 * occupies the same footprint as the happy-path Select trigger.
 */
function cnTrigger(triggerClassName: string | undefined, extra?: string) {
  return cn(
    "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 font-mono text-[11px] transition-colors duration-fast disabled:opacity-60",
    triggerClassName ?? "border-border bg-surface text-text-muted",
    extra,
  );
}

/**
 * ModelPicker · shared dropdown for selecting a model by ref
 * (`<provider.name>/<model.name>` — i.e. the same shape EmployeeDto.model_ref uses).
 *
 * V2 (ADR 0016) upgrade:
 *   - The trigger is a pill showing `<BrandMark />` + model name + chevron
 *     (the chevron is supplied by the underlying `<Select>`).
 *   - Grouping / selected-row styling (bg-primary-muted · 2px left bar) is
 *     handled by `<Select>` itself — we just pass grouped options through.
 *   - Context-window is surfaced as a mono hint on each row instead of a
 *     price chip (no price in ModelDto today — see ADR 0016 · Phase 3).
 */

// Module-level cache so the same tab hitting /employees/design + /chat doesn't
// refetch the gateway state repeatedly. Invalidated only on full page reload —
// gateway mutations happen on the gateway page so the user will be reloading
// adjacent surfaces anyway.
let cached: { providers: ProviderDto[]; models: ModelDto[] } | null = null;
let inflight: Promise<void> | null = null;

async function loadOnce(): Promise<{ providers: ProviderDto[]; models: ModelDto[] }> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      const [providers, models] = await Promise.all([listProviders(), listModels()]);
      cached = { providers, models };
    })();
  }
  await inflight;
  return cached!;
}

export function invalidateModelPickerCache(): void {
  cached = null;
  inflight = null;
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  autoPickDefault?: boolean;
  disabled?: boolean;
  testId?: string;
  inheritLabel?: string;
  size?: "sm" | "md";
  triggerClassName?: string;
  renderTrigger?: (selected: SelectOption | null) => React.ReactNode;
  popoverAlign?: "left" | "right";
  className?: string;
  /**
   * Chip-sized error / loading rendering. Set when the picker lives inside
   * a tight composer / toolbar (`ModelOverrideChip`) where the default
   * "alert card" error state would push neighbouring controls — and the
   * input box on chat — out of frame.
   *
   * 2026-05-05 fix · users reported the chat composer being completely
   * blocked by a 「加载模型列表失败 / Error: listModels failed: 503」
   * card sitting where the textarea should be. In compact mode, error
   * collapses to a small red chip with retry on click; the underlying
   * page (form / chat) keeps full width and the model fallback (employee
   * default) keeps working.
   *
   * Default `false` keeps the form-friendly alert card for the employee
   * designer surface.
   */
  compact?: boolean;
  /**
   * Label shown inside the compact error chip when the live list is
   * unavailable. Typically the resolved fallback ref (employee default).
   * Truthful information stays on screen so the user knows *something*
   * is selected even though the picker can't list alternatives.
   */
  compactFallbackLabel?: string;
};

/** Look up a provider by the "<provider.name>/<model.name>" ref. */
function findProviderByRef(
  providers: ProviderDto[],
  ref: string,
): ProviderDto | null {
  const slash = ref.indexOf("/");
  if (slash <= 0) return null;
  const providerName = ref.slice(0, slash);
  return providers.find((p) => p.name === providerName) ?? null;
}

export function ModelPicker({
  value,
  onChange,
  autoPickDefault = true,
  disabled = false,
  testId,
  inheritLabel,
  size,
  triggerClassName,
  renderTrigger,
  popoverAlign,
  className = "w-full",
  compact = false,
  compactFallbackLabel,
}: Props) {
  const t = useTranslations("modelPicker");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; providers: ProviderDto[]; models: ModelDto[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  // 2026-04-29 · 错误态恢复路径:重试 + 手动输入 model_ref。
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState("");
  // attempt 用作 effect deps,递增就重跑加载。
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const data = await loadOnce();
        if (cancelled) return;
        setState({ status: "ready", providers: data.providers, models: data.models });
        if (autoPickDefault && !value) {
          const fallback = defaultModelRef(data.providers, data.models);
          if (fallback) onChange(fallback);
        }
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // only run on mount + on retry. autoPickDefault/value don't need to
    // retrigger loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = () => {
    invalidateModelPickerCache();
    setAttempt((n) => n + 1);
  };

  const grouped = useMemo(() => {
    if (state.status !== "ready") return [];
    const byProvider = new Map<string, { provider: ProviderDto; models: ModelDto[] }>();
    for (const p of state.providers) byProvider.set(p.id, { provider: p, models: [] });
    for (const m of state.models) {
      const g = byProvider.get(m.provider_id);
      if (g && m.enabled) g.models.push(m);
    }
    return Array.from(byProvider.values()).filter(
      (g) => g.provider.enabled && g.models.length > 0,
    );
  }, [state]);

  if (state.status === "loading") {
    if (compact) {
      // Loading shouldn't move the composer layout · render at chip size
      // with a subdued "…" so the textarea / neighbouring controls stay
      // in their natural slots. The full-text loader below is for the
      // employee designer form which has the vertical room.
      return (
        <button
          type="button"
          disabled
          data-testid={testId ?? "model-picker-loading"}
          className={cnTrigger(triggerClassName, "opacity-70")}
        >
          <Icon name="loader" size={11} className="animate-spin shrink-0" />
          <span className="font-mono text-[10px] text-text-subtle">
            {t("loading")}
          </span>
        </button>
      );
    }
    return (
      <div
        data-testid={testId ?? "model-picker-loading"}
        className="py-2 font-mono text-[12px] text-text-subtle"
      >
        {t("loading")}
      </div>
    );
  }

  if (state.status === "error") {
    const errorTestIdShared = testId ? `${testId}-error` : "model-picker-error";
    if (compact) {
      // Chip-sized error · click to retry. The textarea / send button
      // stay laid out exactly as in the happy path. Detail goes in
      // `title` and aria-label so power users / screen readers can still
      // see "503". Manual entry / fallback default are designer-only
      // affordances; chat already has the employee default in effect
      // and a "look at gateway" path via the topbar.
      return (
        <button
          type="button"
          onClick={retry}
          aria-label={t("loadFailedTitle")}
          title={`${t("loadFailedTitle")} · ${state.message} · ${t("retry")}`}
          data-testid={errorTestIdShared}
          className={cnTrigger(
            triggerClassName,
            "border-danger/40 bg-danger-soft text-danger hover:bg-danger-soft/80",
          )}
        >
          <Icon name="alert-circle" size={11} className="shrink-0" />
          <span className="truncate max-w-[140px]">
            {compactFallbackLabel ?? t("loadFailedTitle")}
          </span>
          <Icon name="refresh" size={10} className="shrink-0 opacity-70" />
        </button>
      );
    }
    // 2026-04-29 · 加载模型列表失败时的恢复 UI。
    // 之前只展一行红字 + error message · 用户没有出口:既不能重试,也
    // 不能在不修后端的前提下继续填表。
    // 现在三个出口:
    //   1. 「重试」· 失效缓存 + 重新拉 list_models / list_providers
    //   2. 「跟随默认」· 仅 inheritLabel 存在时(对话场景),value 设空
    //      表示不在本对话覆盖,沿用员工 / 平台默认
    //   3. 「手动输入」· 切到一个简单 input,用户能直接键入
    //      `provider/model` ref(常见场景:平台模型列表挂了但用户记得自
    //      己常用的模型 ref,后端只是 list 接口挂了 chat 不一定挂)
    const errorTestId = errorTestIdShared;
    if (manualMode) {
      return (
        <div className="space-y-2" data-testid={errorTestId}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={manualInput || value}
              onChange={(e) => {
                setManualInput(e.target.value);
                onChange(e.target.value);
              }}
              placeholder={t("manualPlaceholder")}
              data-testid="model-picker-manual-input"
              className="flex-1 h-8 rounded-md border border-border bg-surface px-2.5 font-mono text-[12px] text-text placeholder:text-text-subtle focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => setManualMode(false)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] text-text-muted hover:text-text hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon name="arrow-left" size={11} />
              {t("manualBack")}
            </button>
          </div>
          <p className="text-[10.5px] text-text-subtle leading-snug">
            {t("manualHint")}
          </p>
        </div>
      );
    }
    return (
      <div
        data-testid={errorTestId}
        className="rounded-md border border-danger/30 bg-danger-soft p-3 space-y-2"
        role="alert"
      >
        <div className="flex items-start gap-2">
          <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-danger">
              {t("loadFailedTitle")}
            </p>
            <p className="mt-0.5 font-mono text-[10.5px] text-danger/80 break-all">
              {state.message}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-6">
          <button
            type="button"
            onClick={retry}
            data-testid="model-picker-retry"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-danger/40 bg-surface px-2.5 text-[11px] font-medium text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
          >
            <Icon name="refresh" size={11} />
            {t("retry")}
          </button>
          {inheritLabel !== undefined && (
            <button
              type="button"
              onClick={() => onChange("")}
              data-testid="model-picker-fallback-default"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] text-text-muted hover:text-text hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon name="check" size={11} />
              {inheritLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => setManualMode(true)}
            data-testid="model-picker-manual"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] text-text-muted hover:text-text hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Icon name="edit" size={11} />
            {t("manualEnter")}
          </button>
        </div>
      </div>
    );
  }

  const defaultRef = defaultModelRef(state.providers, state.models);

  const selectGroups: SelectGroup[] = [];
  if (inheritLabel !== undefined) {
    selectGroups.push({
      id: "_inherit",
      label: t("groupDefault"),
      options: [
        {
          value: "",
          label: inheritLabel,
          testId: "model-picker-inherit",
        },
      ],
    });
  }
  for (const { provider, models } of grouped) {
    // 2026-04-25: "default provider" is no longer a provider field — derive
    // it from "any model under me has is_default=true". The model-level dot
    // continues to render via `hint: 默认` on the matching option.
    const providerHostsDefault = models.some((m) => m.is_default);
    selectGroups.push({
      id: provider.id,
      // i18n suffix for "this provider hosts the workspace default model"
      // — derived from `models.some(is_default)` post-2026-04-25, since the
      // provider DTO no longer carries an `is_default` field of its own.
      label: `${provider.name}${providerHostsDefault ? t("providerDefaultSuffix") : ""}`,
      options: models.map((m) => {
        const ref = buildModelRef(provider, m);
        return {
          value: ref,
          label: m.display_name || m.name,
          hint: ref === defaultRef ? t("defaultHint") : undefined,
        };
      }),
    });
  }

  // Default V2 trigger: BrandMark of the selected model's provider + model
  // label. Consumers can still override via `renderTrigger` (ModelOverrideChip
  // uses that to inline the chip into a toolbar).
  const defaultRenderTrigger = (selected: SelectOption | null): React.ReactNode => {
    if (!selected) {
      return <span className="text-text-subtle">{t("triggerEmpty")}</span>;
    }
    const provider = findProviderByRef(state.providers, selected.value);
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        {provider && (
          <BrandMark
            kind={provider.kind}
            name={provider.name}
            size="sm"
            className="shrink-0"
          />
        )}
        <span className="truncate font-medium text-text">{selected.label}</span>
        {selected.hint && (
          <span className="font-mono text-[10px] text-text-subtle">
            {selected.hint}
          </span>
        )}
      </span>
    );
  };

  return (
    <Select
      value={value}
      onChange={onChange}
      disabled={disabled}
      groups={selectGroups}
      testId={testId ?? "model-picker"}
      ariaLabel={t("ariaLabel")}
      className={className}
      triggerClassName={triggerClassName}
      placeholder={t("placeholder")}
      size={size}
      renderTrigger={renderTrigger ?? defaultRenderTrigger}
      popoverAlign={popoverAlign}
    />
  );
}
