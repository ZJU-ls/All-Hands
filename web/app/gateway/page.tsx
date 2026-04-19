"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import { ModelTestDialog } from "@/components/gateway/ModelTestDialog";
import {
  ProviderSection,
  type GatewayProvider,
} from "@/components/gateway/ProviderSection";
import type { GatewayModel } from "@/components/gateway/ModelRow";
import type { PingState } from "@/components/gateway/PingIndicator";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; providers: GatewayProvider[]; models: GatewayModel[] };

const EMPTY_PROVIDER_FORM = {
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
    <Suspense fallback={<AppShell title="模型网关">{null}</AppShell>}>
      <GatewayPageInner />
    </Suspense>
  );
}

function GatewayPageInner() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [openProviders, setOpenProviders] = useState<Set<string>>(new Set());
  const [openInitialised, setOpenInitialised] = useState(false);
  const [pingStates, setPingStates] = useState<Record<string, PingState>>({});
  const [bulkPing, setBulkPing] = useState<
    Record<string, { done: number; total: number } | null>
  >({});

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
      const data = (await res.json()) as {
        ok: boolean;
        latency_ms?: number;
        error?: string;
        error_category?: string;
      };
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
            error: data.error ?? "失败",
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
  }, []);

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

  return (
    <AppShell
      title="模型网关"
      actions={
        <button
          type="button"
          onClick={() => {
            setEditingProviderId(null);
            setProviderForm({ ...EMPTY_PROVIDER_FORM });
          }}
          data-testid="gateway-add-provider"
          className="rounded bg-primary text-primary-fg hover:bg-primary-hover text-[12px] font-medium px-3 py-1.5 transition-colors duration-base"
        >
          + 添加供应商
        </button>
      }
    >
      <div className="h-full flex flex-col min-h-0">
        <section className="flex-1 min-w-0 overflow-y-auto">
          {state.status === "loading" && (
            <div
              data-testid="gateway-loading"
              className="h-full flex items-center justify-center p-6"
            >
              <div className="max-w-md w-full">
                <LoadingState title="加载供应商与模型" />
              </div>
            </div>
          )}
          {state.status === "error" && (
            <div
              data-testid="gateway-error"
              className="h-full flex items-center justify-center p-6"
            >
              <div className="max-w-md w-full">
                <ErrorState
                  title="加载失败"
                  detail={state.message}
                  action={{ label: "重试", onClick: () => void load() }}
                />
              </div>
            </div>
          )}
          {state.status === "ready" && providers.length === 0 && (
            <div
              data-testid="gateway-empty"
              className="h-full flex items-center justify-center p-6"
            >
              <div className="max-w-md w-full">
                <EmptyState
                  title="尚未配置任何供应商"
                  description="添加 OpenAI / DeepSeek / Ollama / 本地 vLLM 等兼容端点即可开始。"
                  action={{
                    label: "添加第一个供应商 →",
                    onClick: () => {
                      setEditingProviderId(null);
                      setProviderForm({ ...EMPTY_PROVIDER_FORM });
                    },
                  }}
                />
              </div>
            </div>
          )}
          {state.status === "ready" && providers.length > 0 && (
            <div data-testid="gateway-accordion">
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
            </div>
          )}
        </section>
      </div>

      {providerForm !== null && (
        <ProviderFormDialog
          editing={editingProviderId !== null}
          form={providerForm}
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
        title={`删除供应商 ${deleteProviderTarget?.name ?? ""}?`}
        message={
          "此操作不可撤销。其下注册的所有模型会一并删除。\n\n建议先把依赖它的员工迁移到其它供应商。"
        }
        confirmLabel="删除"
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteProviderConfirmed()}
        onCancel={() => setDeleteProviderTarget(null)}
      />
      <ConfirmDialog
        open={deleteModelTarget !== null}
        title={`删除模型 ${
          deleteModelTarget?.display_name || deleteModelTarget?.name || ""
        }?`}
        message={"此操作不可撤销。已绑定该模型的员工将回退到供应商默认模型。"}
        confirmLabel="删除"
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteModelConfirmed()}
        onCancel={() => setDeleteModelTarget(null)}
      />
    </AppShell>
  );
}

function ProviderFormDialog({
  editing,
  form,
  onChange,
  saving,
  onCancel,
  onSave,
}: {
  editing: boolean;
  form: typeof EMPTY_PROVIDER_FORM;
  onChange: (f: typeof EMPTY_PROVIDER_FORM) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal onClose={onCancel} title={editing ? "编辑 LLM 供应商" : "添加 LLM 供应商"}>
      <div className="flex flex-col gap-3">
        <LabeledInput
          label="名称"
          placeholder="例: OpenAI / DeepSeek / 本地 Ollama"
          value={form.name}
          onChange={(v) => onChange({ ...form, name: v })}
        />
        <LabeledInput
          label="Base URL"
          placeholder="https://api.openai.com/v1"
          mono
          value={form.base_url}
          onChange={(v) => onChange({ ...form, base_url: v })}
        />
        <LabeledInput
          label={editing ? "API Key (留空则不变)" : "API Key"}
          type="password"
          placeholder="sk-... (本地部署可留空)"
          value={form.api_key}
          onChange={(v) => onChange({ ...form, api_key: v })}
        />
        <LabeledInput
          label="默认模型"
          mono
          placeholder="gpt-4o-mini"
          value={form.default_model}
          onChange={(v) => onChange({ ...form, default_model: v })}
        />
        {!editing && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.set_as_default}
              onChange={(e) => onChange({ ...form, set_as_default: e.target.checked })}
            />
            <span className="text-xs text-text-muted">设为默认供应商</span>
          </label>
        )}
        <DialogFooter
          saveLabel={saving ? "保存中" : "保存"}
          saveDisabled={saving || !form.name || !form.base_url}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>
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
  return (
    <Modal onClose={onCancel} title={`注册模型 · ${providerName}`}>
      <div className="flex flex-col gap-3">
        <LabeledInput
          label="模型名称 (API 调用值)"
          mono
          placeholder="gpt-4o-mini"
          value={form.name}
          onChange={(v) => onChange({ ...form, name: v })}
        />
        <LabeledInput
          label="显示名称 (可选)"
          placeholder="GPT-4o Mini"
          value={form.display_name}
          onChange={(v) => onChange({ ...form, display_name: v })}
        />
        <LabeledInput
          label="上下文窗口 tokens (可选)"
          placeholder="128000"
          value={String(form.context_window || "")}
          onChange={(v) => onChange({ ...form, context_window: Number(v) || 0 })}
        />
        <DialogFooter
          saveLabel={saving ? "保存中" : "保存"}
          saveDisabled={saving || !form.name}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5"
        style={{ animation: "ah-fade-up 220ms var(--ease-out) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-text-muted hover:text-text text-lg leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DialogFooter({
  saveLabel,
  saveDisabled,
  onCancel,
  onSave,
}: {
  saveLabel: string;
  saveDisabled: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex gap-2 pt-1 justify-end">
      <button
        type="button"
        onClick={onCancel}
        className="rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[12px] px-3 py-1.5 transition-colors duration-base"
      >
        取消
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saveDisabled}
        className="rounded bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 text-[12px] font-medium px-3 py-1.5 transition-colors duration-base"
      >
        {saveLabel}
      </button>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md bg-bg border border-border focus:border-primary outline-none px-3 py-2 text-sm text-text placeholder-text-subtle transition-colors duration-base ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
