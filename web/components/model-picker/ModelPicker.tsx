"use client";

import { useEffect, useMemo, useState } from "react";
import { Select, type SelectGroup } from "@/components/ui/Select";
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
 * Responsibilities:
 *   - Fetch /api/providers + /api/models once on mount (cached at module scope
 *     so repeated instances don't spam the gateway).
 *   - If `value` is empty, auto-select the platform default (is_default provider's
 *     default_model) and bubble that choice up via onChange — this is how Track δ
 *     satisfies #5b (no free-text input; default is the platform default).
 *   - Group options by provider in optgroups so the dropdown is scannable even
 *     when many models are registered.
 *   - Visually compose with BrandMark beside the trigger so the chosen model is
 *     recognisable at a glance.
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
  /**
   * When true + value is empty, auto-emit the platform default on mount.
   * Defaults to true — callers who want a "no default" state (e.g. an optional
   * override) can set it to false.
   */
  autoPickDefault?: boolean;
  disabled?: boolean;
  testId?: string;
  /** Optional "leave empty to inherit" entry (used by per-conversation override). */
  inheritLabel?: string;
};

export function ModelPicker({
  value,
  onChange,
  autoPickDefault = true,
  disabled = false,
  testId,
  inheritLabel,
}: Props) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; providers: ProviderDto[]; models: ModelDto[] } | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadOnce();
        if (cancelled) return;
        setState({ status: "ready", providers: data.providers, models: data.models });
        if (autoPickDefault && !value) {
          const fallback = defaultModelRef(data.providers);
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
    return Array.from(byProvider.values()).filter((g) => g.provider.enabled && g.models.length > 0);
  }, [state]);

  if (state.status === "loading") {
    return (
      <div
        data-testid={testId ?? "model-picker-loading"}
        className="text-[12px] font-mono text-text-subtle py-2"
      >
        加载模型列表…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        data-testid={testId ? `${testId}-error` : "model-picker-error"}
        className="text-[12px] font-mono text-danger py-2"
      >
        加载模型失败 · {state.message}
      </div>
    );
  }

  const defaultRef = defaultModelRef(state.providers);

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
    selectGroups.push({
      id: provider.id,
      label: `${provider.name}${provider.is_default ? " · 默认" : ""}`,
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

  return (
    <Select
      value={value}
      onChange={onChange}
      disabled={disabled}
      groups={selectGroups}
      testId={testId ?? "model-picker"}
      ariaLabel="选择模型"
      className="w-full"
      triggerClassName="font-mono"
      placeholder="选择模型…"
    />
  );
}
