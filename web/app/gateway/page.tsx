"use client";

/**
 * Gateway · LLM provider + model console (ADR 0016 · V2 Azure Live polish).
 *
 * Users land here to audit which vendors their workspace can call, flip
 * defaults, and health-check models. The page is a top-down admin console:
 * 1. Small hero — brand identity + quick "Test all" CTA
 * 2. Stats strip — provider / model / default-set counts
 * 3. Provider accordion — delegated to <ProviderSection> (per-vendor row
 *    with BrandMark tile + chips + nested model list)
 * 4. Empty / loading / error fall back to mesh-hero + shimmer rows
 * 5. Dialogs — sectioned forms · API key eye-toggle
 *
 * Data/mutation/fetch/state contracts are preserved from the previous
 * revision. All data-testid / user-facing button labels ("保存", "删除",
 * "取消", "添加第一个供应商 →", "重试") are kept for e2e compatibility.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/state";
import { Icon } from "@/components/ui/icon";
import { BrandMark, resolveBrand, type BrandSlug } from "@/components/brand/BrandMark";
import { PageHeader } from "@/components/ui/PageHeader";
import { ModelTestDialog } from "@/components/gateway/ModelTestDialog";
import {
  ProviderSection,
  type GatewayProvider,
  type ProviderKind,
} from "@/components/gateway/ProviderSection";
import type { GatewayModel } from "@/components/gateway/ModelRow";
import { useDismissOnEscape } from "@/lib/use-dismiss-on-escape";
import type { PingState } from "@/components/gateway/PingIndicator";

type ProviderPreset = {
  kind: ProviderKind;
  label: string;
  base_url: string;
  default_model: string;
  key_hint: string;
  doc_hint: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; providers: GatewayProvider[]; models: GatewayModel[] };

const EMPTY_PROVIDER_FORM = {
  kind: "openai" as ProviderKind,
  name: "",
  base_url: "https://api.openai.com/v1",
  api_key: "",
  default_model: "gpt-4o-mini",
  set_as_default: false,
};

const EMPTY_MODEL_FORM = {
  name: "",
  display_name: "",
  context_window: 0,
};

export default function GatewayPage() {
  return (
    <Suspense fallback={<GatewayFallback />}>
      <GatewayPageInner />
    </Suspense>
  );
}

function GatewayFallback() {
  const t = useTranslations("gateway.page");
  return <AppShell title={t("title")}>{null}</AppShell>;
}

function GatewayPageInner() {
  const t = useTranslations("gateway.page");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [openProviders, setOpenProviders] = useState<Set<string>>(new Set());
  const [openInitialised, setOpenInitialised] = useState(false);
  const [pingStates, setPingStates] = useState<Record<string, PingState>>({});
  const [bulkPing, setBulkPing] = useState<
    Record<string, { done: number; total: number } | null>
  >({});
  const [testAllBusy, setTestAllBusy] = useState(false);

  const [providerForm, setProviderForm] = useState<typeof EMPTY_PROVIDER_FORM | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [modelFormFor, setModelFormFor] = useState<GatewayProvider | null>(null);
  const [modelForm, setModelForm] = useState<typeof EMPTY_MODEL_FORM>(EMPTY_MODEL_FORM);

  const [saving, setSaving] = useState(false);
  const [deleteProviderTarget, setDeleteProviderTarget] =
    useState<GatewayProvider | null>(null);
  const [deleteModelTarget, setDeleteModelTarget] = useState<GatewayModel | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [chatModel, setChatModel] = useState<GatewayModel | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [pRes, mRes] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/models"),
      ]);
      if (!pRes.ok) throw new Error(`providers HTTP ${pRes.status}`);
      if (!mRes.ok) throw new Error(`models HTTP ${mRes.status}`);
      const providers = (await pRes.json()) as GatewayProvider[];
      const models = (await mRes.json()) as GatewayModel[];
      setState({ status: "ready", providers, models });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/providers/presets");
        if (!res.ok) return;
        setPresets((await res.json()) as ProviderPreset[]);
      } catch {
        // non-fatal — dialog falls back to free-form input
      }
    })();
  }, []);

  // Default: on first successful load, open every provider. User toggles after
  // that are preserved across refetches (we only seed the open set once).
  useEffect(() => {
    if (state.status !== "ready" || openInitialised) return;
    setOpenProviders(new Set(state.providers.map((p) => p.id)));
    setOpenInitialised(true);
  }, [state, openInitialised]);

  const providers = useMemo(
    () => (state.status === "ready" ? state.providers : []),
    [state],
  );
  const allModels = useMemo(
    () => (state.status === "ready" ? state.models : []),
    [state],
  );
  const defaultProvider = useMemo(
    () => providers.find((p) => p.is_default) ?? null,
    [providers],
  );
  const enabledCount = useMemo(
    () => providers.filter((p) => p.enabled).length,
    [providers],
  );

  const toggleProvider = useCallback((id: string) => {
    setOpenProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pingOne = useCallback(async (model: GatewayModel) => {
    setPingStates((prev) => ({ ...prev, [model.id]: { status: "running" } }));
    const started = performance.now();
    try {
      const res = await fetch(`/api/models/${model.id}/ping`, { method: "POST" });
      const elapsed = Math.round(performance.now() - started);
      if (!res.ok) {
        setPingStates((prev) => ({
          ...prev,
          [model.id]: {
            status: "fail",
            category: "provider_error",
            error: `HTTP ${res.status}`,
            latencyMs: elapsed,
          },
        }));
        return;
      }
      // New 2-layer ping shape (services/connectivity.py · to_legacy_shape)
      type PingResponse = {
        ok: boolean;
        latency_ms?: number;
        error?: string | null;
        error_category?: string | null;
        status?:
          | "ok"
          | "degraded"
          | "endpoint_unreachable"
          | "auth_failed"
          | "model_unavailable";
        endpoint?: {
          reachable: boolean;
          auth_ok: boolean | null;
          status_code: number | null;
          latency_ms: number;
          error_kind:
            | "ok"
            | "network"
            | "timeout"
            | "auth"
            | "not_found"
            | "server_error"
            | "unknown";
          error?: string | null;
        };
        model_probe?: {
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
          status_code: number | null;
          latency_ms: number;
          error?: string | null;
        };
      };
      const data = (await res.json()) as PingResponse;

      // Prefer the structured 2-layer state when the backend returned it.
      if (data.endpoint && data.model_probe && data.status) {
        setPingStates((prev) => ({
          ...prev,
          [model.id]: {
            status: "done",
            overall: data.status!,
            endpoint: {
              reachable: data.endpoint!.reachable,
              authOk: data.endpoint!.auth_ok,
              statusCode: data.endpoint!.status_code,
              latencyMs: data.endpoint!.latency_ms,
              errorKind: data.endpoint!.error_kind,
              error: data.endpoint!.error ?? null,
            },
            model: {
              usable: data.model_probe!.usable,
              classification: data.model_probe!.classification,
              statusCode: data.model_probe!.status_code,
              latencyMs: data.model_probe!.latency_ms,
              error: data.model_probe!.error ?? null,
            },
          },
        }));
        return;
      }

      // Fallback to legacy single-tone shape (older backends / mocked tests).
      if (data.ok) {
        setPingStates((prev) => ({
          ...prev,
          [model.id]: {
            status: "ok",
            latencyMs: data.latency_ms ?? elapsed,
          },
        }));
      } else {
        setPingStates((prev) => ({
          ...prev,
          [model.id]: {
            status: "fail",
            category: data.error_category ?? "unknown",
            error: data.error ?? t("pingFailure"),
            latencyMs: data.latency_ms ?? elapsed,
          },
        }));
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - started);
      setPingStates((prev) => ({
        ...prev,
        [model.id]: {
          status: "fail",
          category: "connection",
          error: String(err),
          latencyMs: elapsed,
        },
      }));
    }
  }, [t]);

  const bulkPingProvider = useCallback(
    async (providerId: string, models: GatewayModel[]) => {
      if (models.length === 0) return;
      const enabled = models.filter((m) => m.enabled);
      const total = enabled.length || models.length;
      const targets = enabled.length > 0 ? enabled : models;
      setBulkPing((prev) => ({ ...prev, [providerId]: { done: 0, total } }));
      let done = 0;
      await Promise.all(
        targets.map(async (m) => {
          await pingOne(m);
          done += 1;
          setBulkPing((prev) => ({ ...prev, [providerId]: { done, total } }));
        }),
      );
      setBulkPing((prev) => ({ ...prev, [providerId]: null }));
    },
    [pingOne],
  );

  const testAll = useCallback(async () => {
    if (testAllBusy || allModels.length === 0) return;
    setTestAllBusy(true);
    try {
      const byProvider = new Map<string, GatewayModel[]>();
      for (const m of allModels) {
        const list = byProvider.get(m.provider_id) ?? [];
        list.push(m);
        byProvider.set(m.provider_id, list);
      }
      await Promise.all(
        Array.from(byProvider.entries()).map(([pid, ms]) =>
          bulkPingProvider(pid, ms),
        ),
      );
    } finally {
      setTestAllBusy(false);
    }
  }, [allModels, bulkPingProvider, testAllBusy]);

  async function handleCreateProvider() {
    if (!providerForm) return;
    setSaving(true);
    try {
      await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerForm),
      });
      setProviderForm(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleEditProvider() {
    if (!providerForm || !editingProviderId) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: providerForm.name,
        base_url: providerForm.base_url,
        default_model: providerForm.default_model,
      };
      if (providerForm.api_key) body.api_key = providerForm.api_key;
      // kind is set at creation time and not editable here
      await fetch(`/api/providers/${editingProviderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setProviderForm(null);
      setEditingProviderId(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(id: string) {
    await fetch(`/api/providers/${id}/set-default`, { method: "POST" });
    await load();
  }

  async function handleDeleteProviderConfirmed() {
    if (!deleteProviderTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/providers/${deleteProviderTarget.id}`, { method: "DELETE" });
      setDeleteProviderTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreateModel() {
    if (!modelFormFor) return;
    setSaving(true);
    try {
      await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: modelFormFor.id, ...modelForm }),
      });
      setModelFormFor(null);
      setModelForm(EMPTY_MODEL_FORM);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteModelConfirmed() {
    if (!deleteModelTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/models/${deleteModelTarget.id}`, { method: "DELETE" });
      setDeleteModelTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  const openCreate = () => {
    setEditingProviderId(null);
    setProviderForm({ ...EMPTY_PROVIDER_FORM });
  };

  return (
    <AppShell
      title={t("title")}
      actions={
        <button
          type="button"
          onClick={openCreate}
          data-testid="gateway-add-provider"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-fg text-[12px] font-semibold shadow-soft-sm hover:bg-primary-hover hover:-translate-y-px transition duration-base"
        >
          <Icon name="plus" size={14} />
          {t("addProvider")}
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 space-y-6 animate-fade-up">
          {state.status === "loading" && (
            <>
              <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
              />
              <GatewaySkeleton />
            </>
          )}

          {state.status === "error" && (
            <>
              <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
              />
              <div data-testid="gateway-error">
                <ErrorState
                  title={t("loadFailedTitle")}
                  detail={state.message}
                  action={{ label: t("errorRetry"), onClick: () => void load() }}
                />
              </div>
            </>
          )}

          {state.status === "ready" && providers.length === 0 && (
            <>
              <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
              />
              <EmptyGateway
                onAdd={openCreate}
                presets={presets}
                onPickPreset={(kind) => {
                  const preset = presets.find((p) => p.kind === kind);
                  setEditingProviderId(null);
                  setProviderForm({
                    ...EMPTY_PROVIDER_FORM,
                    kind,
                    base_url: preset?.base_url ?? EMPTY_PROVIDER_FORM.base_url,
                    default_model:
                      preset?.default_model ?? EMPTY_PROVIDER_FORM.default_model,
                  });
                }}
              />
            </>
          )}

          {state.status === "ready" && providers.length > 0 && (
            <>
              <GatewayHero
                providerCount={providers.length}
                modelCount={allModels.length}
                enabledCount={enabledCount}
                defaultProvider={defaultProvider}
                testAllBusy={testAllBusy}
                onTestAll={() => void testAll()}
                onAdd={openCreate}
              />

              <section
                data-testid="gateway-accordion"
                className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden"
              >
                {providers.map((p) => {
                  const models = allModels.filter((m) => m.provider_id === p.id);
                  return (
                    <ProviderSection
                      key={p.id}
                      provider={p}
                      models={models}
                      open={openProviders.has(p.id)}
                      onToggle={() => toggleProvider(p.id)}
                      pingStates={pingStates}
                      onPingModel={pingOne}
                      onBulkPing={() => void bulkPingProvider(p.id, models)}
                      bulkPingInProgress={bulkPing[p.id] ?? null}
                      onSetDefault={() => void handleSetDefault(p.id)}
                      onEdit={() => {
                        setEditingProviderId(p.id);
                        setProviderForm({
                          kind: p.kind,
                          name: p.name,
                          base_url: p.base_url,
                          api_key: "",
                          default_model: p.default_model,
                          set_as_default: p.is_default,
                        });
                      }}
                      onDelete={() => setDeleteProviderTarget(p)}
                      onAddModel={() => {
                        setModelForm(EMPTY_MODEL_FORM);
                        setModelFormFor(p);
                      }}
                      onChatTestModel={(m) => setChatModel(m)}
                      onDeleteModel={(m) => setDeleteModelTarget(m)}
                    />
                  );
                })}
              </section>
            </>
          )}
        </div>
      </div>

      {providerForm !== null && (
        <ProviderFormDialog
          editing={editingProviderId !== null}
          form={providerForm}
          presets={presets}
          onChange={setProviderForm}
          saving={saving}
          onCancel={() => {
            setProviderForm(null);
            setEditingProviderId(null);
          }}
          onSave={() =>
            void (editingProviderId ? handleEditProvider() : handleCreateProvider())
          }
        />
      )}
      {modelFormFor !== null && (
        <ModelFormDialog
          providerName={modelFormFor.name}
          form={modelForm}
          onChange={setModelForm}
          saving={saving}
          onCancel={() => setModelFormFor(null)}
          onSave={() => void handleCreateModel()}
        />
      )}
      {chatModel && (
        <ModelTestDialog model={chatModel} onClose={() => setChatModel(null)} />
      )}
      <ConfirmDialog
        open={deleteProviderTarget !== null}
        title={t("deleteProviderTitle", { name: deleteProviderTarget?.name ?? "" })}
        message={t("deleteProviderMessage")}
        confirmLabel={t("deleteAction")}
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteProviderConfirmed()}
        onCancel={() => setDeleteProviderTarget(null)}
      />
      <ConfirmDialog
        open={deleteModelTarget !== null}
        title={t("deleteModelTitle", {
          name: deleteModelTarget?.display_name || deleteModelTarget?.name || "",
        })}
        message={t("deleteModelMessage")}
        confirmLabel={t("deleteAction")}
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteModelConfirmed()}
        onCancel={() => setDeleteModelTarget(null)}
      />
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero + stats                                                       */
/* ------------------------------------------------------------------ */

function GatewayHero({
  providerCount,
  modelCount,
  enabledCount,
  defaultProvider,
  testAllBusy,
  onTestAll,
  onAdd,
}: {
  providerCount: number;
  modelCount: number;
  enabledCount: number;
  defaultProvider: GatewayProvider | null;
  testAllBusy: boolean;
  onTestAll: () => void;
  onAdd: () => void;
}) {
  const t = useTranslations("gateway.page");
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-sm"
      aria-labelledby="gateway-hero-title"
    >
      {/* Mesh backdrop — soft primary/accent radials */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60 pointer-events-none"
        style={{
          background:
            "radial-gradient(600px 260px at 10% 0%, var(--color-primary-muted), transparent 60%), radial-gradient(500px 320px at 95% 40%, color-mix(in srgb, var(--color-accent, var(--color-primary)) 16%, transparent), transparent 65%)",
        }}
      />
      {/* 1px primary hairline at top */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
      />

      <div className="relative p-6 flex items-start gap-5">
        <div
          aria-hidden="true"
          className="shrink-0 grid h-14 w-14 place-items-center rounded-2xl text-primary-fg shadow-soft"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
        >
          <Icon name="plug" size={26} strokeWidth={1.5} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1
              id="gateway-hero-title"
              className="text-[22px] md:text-[26px] font-semibold tracking-tight text-text"
            >
              {t("title")}
            </h1>
            <span className="font-mono text-[11px] tabular-nums text-text-subtle">
              {t("heroCounter", { providers: providerCount, models: modelCount })}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-text-muted leading-relaxed">
            {defaultProvider
              ? t("heroDefaultLine", {
                  label: `${defaultProvider.name}/${defaultProvider.default_model}`,
                })
              : t("heroNoDefault")}
          </p>

          {/* stats chips */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatChip icon="server" label={t("statProviders")} value={providerCount} />
            <StatChip icon="brain" label={t("statModels")} value={modelCount} />
            <StatChip
              icon="check-circle-2"
              label={t("statEnabled")}
              value={enabledCount}
              tone="success"
            />
            {defaultProvider && (
              <span
                className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-primary/10 text-primary text-[11px] font-semibold border border-primary/20"
                title={t("globalDefaultTooltip")}
              >
                <Icon name="star" size={11} />
                {t("statGlobalDefault", {
                  label: `${defaultProvider.name}/${defaultProvider.default_model}`,
                })}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={onTestAll}
            disabled={testAllBusy || modelCount === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-surface border border-border text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text transition duration-base"
          >
            {testAllBusy ? (
              <>
                <Icon name="loader" size={13} className="animate-spin-slow" />
                {t("testAllRunning")}
              </>
            ) : (
              <>
                <Icon name="activity" size={13} />
                {t("testAll")}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-fg text-[12px] font-semibold shadow-soft hover:bg-primary-hover hover:-translate-y-px transition duration-base"
          >
            <Icon name="plus" size={13} />
            {t("addProvider")}
          </button>
        </div>
      </div>
    </section>
  );
}

function StatChip({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: number;
  tone?: "default" | "success";
}) {
  const toneCls =
    tone === "success"
      ? "border-success/25 text-success bg-success-soft"
      : "border-border text-text-muted bg-surface-2";
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full border ${toneCls} text-[11px] font-medium`}
    >
      <Icon name={icon} size={11} />
      <span className="tabular-nums font-semibold text-text">{value}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
        {label}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyGateway({
  onAdd,
  presets,
  onPickPreset,
}: {
  onAdd: () => void;
  presets: ProviderPreset[];
  onPickPreset: (kind: ProviderKind) => void;
}) {
  const t = useTranslations("gateway.page");
  return (
    <div
      data-testid="gateway-empty"
      className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-sm"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70 pointer-events-none"
        style={{
          background:
            "radial-gradient(600px 300px at 15% 20%, var(--color-primary-muted), transparent 60%), radial-gradient(500px 400px at 85% 60%, color-mix(in srgb, var(--color-accent, var(--color-primary)) 18%, transparent), transparent 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-35 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      <div className="relative px-6 py-14 grid place-items-center text-center">
        <div
          className="grid h-20 w-20 place-items-center rounded-2xl text-primary-fg shadow-soft-lg animate-float"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name="plug" size={34} strokeWidth={1.5} />
        </div>

        <h3 className="mt-6 text-[26px] md:text-[30px] font-semibold tracking-tight text-text">
          {t("emptyHeadline")}
        </h3>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-text-muted">
          {t("emptyDescription")}
        </p>

        <button
          type="button"
          onClick={onAdd}
          className="mt-5 inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-primary text-primary-fg text-[13px] font-semibold shadow-soft hover:bg-primary-hover hover:-translate-y-px transition duration-base"
        >
          <Icon name="plus" size={14} />
          {t("addFirstProvider")}
        </button>

        {presets.length > 0 && (
          <div className="mt-8 w-full max-w-lg">
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-subtle mb-2">
              {t("orStartFromPreset")}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {presets.map((p) => {
                const slug = resolveBrand(p.kind, p.label) as BrandSlug | null;
                return (
                  <button
                    key={p.kind}
                    type="button"
                    onClick={() => onPickPreset(p.kind)}
                    className="group relative flex items-center gap-2 h-11 px-3 rounded-lg bg-surface border border-border hover:border-primary/40 hover:bg-primary/5 hover:-translate-y-px shadow-soft-sm transition duration-base text-left"
                  >
                    {slug ? (
                      <BrandMark kind={p.kind} name={p.label} size="sm" />
                    ) : (
                      <Icon
                        name="server"
                        size={14}
                        className="text-text-muted"
                      />
                    )}
                    <span className="text-[12px] font-medium text-text truncate flex-1">
                      {p.label}
                    </span>
                    <Icon
                      name="arrow-right"
                      size={12}
                      className="text-text-subtle group-hover:text-primary group-hover:translate-x-0.5 transition duration-base"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function GatewaySkeleton() {
  const shimmer =
    "bg-surface-3 animate-shimmer bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]";
  return (
    <div
      aria-hidden="true"
      data-testid="gateway-loading"
      className="space-y-4"
    >
      {/* hero skeleton */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-soft-sm flex items-start gap-5">
        <div className={`h-14 w-14 rounded-2xl ${shimmer}`} />
        <div className="flex-1 space-y-2.5">
          <div className={`h-5 w-40 rounded ${shimmer}`} />
          <div className={`h-3 w-80 rounded ${shimmer}`} />
          <div className="flex gap-2 pt-1">
            <div className={`h-6 w-20 rounded-full ${shimmer}`} />
            <div className={`h-6 w-20 rounded-full ${shimmer}`} />
            <div className={`h-6 w-24 rounded-full ${shimmer}`} />
          </div>
        </div>
        <div className={`h-9 w-36 rounded-lg ${shimmer}`} />
      </div>
      {/* rows skeleton */}
      <div className="rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden divide-y divide-border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <div className={`h-5 w-5 rounded ${shimmer}`} />
            <div className={`h-7 w-7 rounded-full ${shimmer}`} />
            <div className={`h-3.5 w-40 rounded ${shimmer}`} />
            <div className={`h-3 w-24 rounded ${shimmer}`} />
            <div className="ml-auto flex gap-2">
              <div className={`h-6 w-20 rounded ${shimmer}`} />
              <div className={`h-6 w-12 rounded ${shimmer}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Form dialogs                                                       */
/* ------------------------------------------------------------------ */

function ProviderFormDialog({
  editing,
  form,
  presets,
  onChange,
  saving,
  onCancel,
  onSave,
}: {
  editing: boolean;
  form: typeof EMPTY_PROVIDER_FORM;
  presets: ProviderPreset[];
  onChange: (f: typeof EMPTY_PROVIDER_FORM) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("gateway.page");
  const currentPreset = presets.find((p) => p.kind === form.kind);
  const keyPlaceholder = currentPreset?.key_hint || t("fieldApiKeyPlaceholderFallback");
  const baseUrlPlaceholder = currentPreset?.base_url || "https://api.openai.com/v1";
  const defaultModelPlaceholder = currentPreset?.default_model || "gpt-4o-mini";

  function handleKindChange(nextKind: ProviderKind) {
    const next = presets.find((p) => p.kind === nextKind);
    onChange({
      ...form,
      kind: nextKind,
      // Autofill canonical values, but only overwrite if the user hasn't typed a
      // different value yet (or is still sitting on the previous preset's default).
      base_url:
        next && (form.base_url === "" || presets.some((p) => p.base_url === form.base_url))
          ? next.base_url
          : form.base_url,
      default_model:
        next && (form.default_model === "" || presets.some((p) => p.default_model === form.default_model))
          ? next.default_model
          : form.default_model,
    });
  }

  return (
    <Modal
      onClose={onCancel}
      title={editing ? t("providerDialogEditTitle") : t("providerDialogCreateTitle")}
      subtitle={
        editing
          ? t("providerDialogEditSubtitle")
          : t("providerDialogCreateSubtitle")
      }
      iconName={editing ? "edit" : "plug"}
    >
      <FormSection
        label={t("sectionFormat")}
        hint={editing ? t("formatLockedHint") : undefined}
      >
        {presets.length === 0 ? (
          <p className="text-[11px] text-text-muted">{t("presetsLoading")}</p>
        ) : (
          <div
            role="radiogroup"
            aria-label={t("sectionFormat")}
            data-testid="provider-kind-radiogroup"
            className="grid grid-cols-3 gap-2"
          >
            {presets.map((p) => {
              const selected = form.kind === p.kind;
              const disabled = editing && !selected;
              return (
                <button
                  key={p.kind}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => handleKindChange(p.kind)}
                  data-testid={`provider-kind-${p.kind}`}
                  className={`group relative rounded-lg border px-2.5 py-2.5 text-left transition duration-base disabled:opacity-40 disabled:cursor-not-allowed ${
                    selected
                      ? "border-primary bg-primary/10 text-text shadow-soft-sm"
                      : "border-border bg-surface hover:border-primary/40 hover:bg-primary/5 text-text-muted hover:text-text"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <BrandMark kind={p.kind} name={p.label} size="sm" />
                    <div className="font-mono text-[9px] text-text-subtle uppercase tracking-wider">
                      {p.kind}
                    </div>
                  </div>
                  <div className="text-[12px] font-semibold truncate">
                    {p.label}
                  </div>
                  {selected && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
        {currentPreset && (
          <p
            data-testid="provider-kind-hint"
            className="mt-2 text-[11px] text-text-muted flex items-start gap-1.5"
          >
            <Icon
              name="info"
              size={11}
              className="mt-0.5 shrink-0 text-text-subtle"
            />
            <span>{currentPreset.doc_hint}</span>
          </p>
        )}
      </FormSection>

      <FormSection label={t("sectionConnection")}>
        <LabeledInput
          label={t("fieldName")}
          placeholder={t("fieldNamePlaceholder")}
          value={form.name}
          onChange={(v) => onChange({ ...form, name: v })}
        />
        <LabeledInput
          label={t("fieldBaseUrl")}
          placeholder={baseUrlPlaceholder}
          mono
          value={form.base_url}
          onChange={(v) => onChange({ ...form, base_url: v })}
          icon="link"
        />
        <ApiKeyInput
          label={editing ? t("fieldApiKeyEdit") : t("fieldApiKey")}
          placeholder={keyPlaceholder}
          value={form.api_key}
          onChange={(v) => onChange({ ...form, api_key: v })}
        />
      </FormSection>

      <FormSection label={t("sectionDefault")}>
        <LabeledInput
          label={t("fieldDefaultModel")}
          mono
          placeholder={defaultModelPlaceholder}
          value={form.default_model}
          onChange={(v) => onChange({ ...form, default_model: v })}
          icon="brain"
        />
        {!editing && (
          <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={form.set_as_default}
              onChange={(e) =>
                onChange({ ...form, set_as_default: e.target.checked })
              }
              className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary/20"
            />
            <span className="text-[12px] text-text-muted inline-flex items-center gap-1.5">
              <Icon
                name="star"
                size={11}
                className="text-text-subtle"
              />
              {t("setAsDefault")}
            </span>
          </label>
        )}
      </FormSection>

      <DialogFooter
        saveLabel={saving ? t("saving") : t("save")}
        saveDisabled={saving || !form.name || !form.base_url}
        busy={saving}
        onCancel={onCancel}
        onSave={onSave}
      />
    </Modal>
  );
}

function ModelFormDialog({
  providerName,
  form,
  onChange,
  saving,
  onCancel,
  onSave,
}: {
  providerName: string;
  form: typeof EMPTY_MODEL_FORM;
  onChange: (f: typeof EMPTY_MODEL_FORM) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("gateway.page");
  return (
    <Modal
      onClose={onCancel}
      title={t("registerModelTitle")}
      subtitle={
        <>
          {t("registerModelOwner")}
          <span className="font-mono text-text ml-1">{providerName}</span>
        </>
      }
      iconName="brain"
    >
      <FormSection label={t("sectionIdentity")}>
        <LabeledInput
          label={t("fieldModelName")}
          mono
          placeholder="gpt-4o-mini"
          value={form.name}
          onChange={(v) => onChange({ ...form, name: v })}
          icon="terminal"
        />
        <LabeledInput
          label={t("fieldDisplayName")}
          placeholder="GPT-4o Mini"
          value={form.display_name}
          onChange={(v) => onChange({ ...form, display_name: v })}
        />
      </FormSection>
      <FormSection label={t("sectionCapability")}>
        <LabeledInput
          label={t("fieldContextWindow")}
          placeholder="128000"
          value={String(form.context_window || "")}
          onChange={(v) => onChange({ ...form, context_window: Number(v) || 0 })}
          icon="database"
        />
      </FormSection>
      <DialogFooter
        saveLabel={saving ? t("saving") : t("save")}
        saveDisabled={saving || !form.name}
        busy={saving}
        onCancel={onCancel}
        onSave={onSave}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Dialog primitives                                                  */
/* ------------------------------------------------------------------ */

function Modal({
  title,
  subtitle,
  iconName,
  children,
  onClose,
}: {
  title: string;
  subtitle?: React.ReactNode;
  iconName?: Parameters<typeof Icon>[0]["name"];
  children: React.ReactNode;
  onClose: () => void;
}) {
  const t = useTranslations("gateway.page");
  // ESC = close — shared by all ProviderFormDialog / ModelFormDialog on Gateway
  useDismissOnEscape(true, onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-border bg-surface shadow-soft-lg overflow-hidden"
        style={{
          animation: "ah-fade-up 320ms cubic-bezier(.16,1,.3,1) both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden="true"
          className="h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
        />
        <header className="flex items-start gap-3 p-5 pb-4">
          {iconName && (
            <div
              aria-hidden="true"
              className="shrink-0 grid h-9 w-9 place-items-center rounded-lg text-primary-fg shadow-soft-sm"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
              }}
            >
              <Icon name={iconName} size={16} strokeWidth={1.75} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-text tracking-tight">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[11px] text-text-muted mt-0.5 leading-snug">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("modalClose")}
            className="shrink-0 grid h-7 w-7 place-items-center rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors duration-fast"
          >
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="px-5 pb-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function FormSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle">
          {label}
        </span>
        <span
          aria-hidden="true"
          className="flex-1 h-px bg-gradient-to-r from-border to-transparent"
        />
      </div>
      <div className="space-y-2.5">{children}</div>
      {hint && (
        <p className="text-[11px] text-text-subtle flex items-start gap-1.5">
          <Icon
            name="alert-triangle"
            size={11}
            className="mt-0.5 shrink-0 text-warning"
          />
          <span>{hint}</span>
        </p>
      )}
    </section>
  );
}

function DialogFooter({
  saveLabel,
  saveDisabled,
  busy,
  onCancel,
  onSave,
}: {
  saveLabel: string;
  saveDisabled: boolean;
  busy?: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("gateway.page");
  return (
    <div className="flex gap-2 pt-2 justify-end border-t border-border -mx-5 px-5 pt-4 mt-1">
      <button
        type="button"
        onClick={onCancel}
        className="h-9 px-3.5 rounded-lg bg-surface border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[12px] font-medium transition duration-base"
      >
        {t("cancel")}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saveDisabled}
        className="h-9 px-4 rounded-lg bg-primary text-primary-fg hover:bg-primary-hover hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0 text-[12px] font-semibold shadow-soft-sm transition duration-base inline-flex items-center gap-1.5"
      >
        {busy && <Icon name="loader" size={12} className="animate-spin-slow" />}
        {saveLabel}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Input primitives                                                   */
/* ------------------------------------------------------------------ */

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  icon?: Parameters<typeof Icon>[0]["name"];
}) {
  return (
    <div>
      <label className="text-[11px] font-medium text-text-muted block mb-1">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <Icon
            name={icon}
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none"
          />
        )}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full h-9 rounded-md bg-surface border border-border focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary text-[13px] text-text placeholder:text-text-subtle transition duration-base ${
            icon ? "pl-8 pr-3" : "px-3"
          } ${mono ? "font-mono text-[12.5px]" : ""}`}
        />
      </div>
    </div>
  );
}

function ApiKeyInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const t = useTranslations("gateway.page");
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="text-[11px] font-medium text-text-muted block mb-1 inline-flex items-center gap-1.5">
        <Icon name="lock" size={11} className="text-text-subtle" />
        {label}
      </label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="w-full h-9 rounded-md bg-surface border border-border focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary px-3 pr-9 font-mono text-[12.5px] text-text placeholder:text-text-subtle transition duration-base"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("apiKeyHide") : t("apiKeyShow")}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-fast"
        >
          <Icon name={visible ? "eye-off" : "eye"} size={13} />
        </button>
      </div>
    </div>
  );
}

