"use client";

import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { Select, type SelectGroup, type SelectOption } from "@/components/ui/Select";
import {
  buildModelRef,
  defaultModelRef,
  listModels,
  listProviders,
  type ModelDto,
  type ProviderDto,
} from "@/lib/api";

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
}: Props) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; providers: ProviderDto[]; models: ModelDto[] }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
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
    // only run on mount — autoPickDefault/value don't need to retrigger loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return (
      <div
        data-testid={testId ?? "model-picker-loading"}
        className="py-2 font-mono text-[12px] text-text-subtle"
      >
        加载模型列表…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        data-testid={testId ? `${testId}-error` : "model-picker-error"}
        className="py-2 font-mono text-[12px] text-danger"
      >
        加载模型失败 · {state.message}
      </div>
    );
  }

  const defaultRef = defaultModelRef(state.providers, state.models);

  const selectGroups: SelectGroup[] = [];
  if (inheritLabel !== undefined) {
    selectGroups.push({
      id: "_inherit",
      label: "默认",
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
      label: `${provider.name}${providerHostsDefault ? " · 默认" : ""}`,
      options: models.map((m) => {
        const ref = buildModelRef(provider, m);
        return {
          value: ref,
          label: m.display_name || m.name,
          hint: ref === defaultRef ? "默认" : undefined,
        };
      }),
    });
  }

  // Default V2 trigger: BrandMark of the selected model's provider + model
  // label. Consumers can still override via `renderTrigger` (ModelOverrideChip
  // uses that to inline the chip into a toolbar).
  const defaultRenderTrigger = (selected: SelectOption | null): React.ReactNode => {
    if (!selected) {
      return <span className="text-text-subtle">选择模型…</span>;
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
      ariaLabel="选择模型"
      className={className}
      triggerClassName={triggerClassName}
      placeholder="选择模型…"
      size={size}
      renderTrigger={renderTrigger ?? defaultRenderTrigger}
      popoverAlign={popoverAlign}
    />
  );
}
