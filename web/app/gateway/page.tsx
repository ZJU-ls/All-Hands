"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ModelTestDialog } from "@/components/gateway/ModelTestDialog";

type Provider = {
  id: string;
  name: string;
  base_url: string;
  api_key_set: boolean;
  default_model: string;
  is_default: boolean;
  enabled: boolean;
};

type Model = {
  id: string;
  provider_id: string;
  name: string;
  display_name: string;
  context_window: number;
  enabled: boolean;
};

type TestState = { ok: boolean; msg: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; providers: Provider[]; models: Model[] };

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
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("provider") ?? "";

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [providerForm, setProviderForm] = useState<typeof EMPTY_PROVIDER_FORM | null>(
    null
  );
  const [modelForm, setModelForm] = useState<typeof EMPTY_MODEL_FORM | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteProviderTarget, setDeleteProviderTarget] = useState<Provider | null>(null);
  const [deleteModelTarget, setDeleteModelTarget] = useState<Model | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [chatModel, setChatModel] = useState<Model | null>(null);

  const load = async () => {
    setState({ status: "loading" });
    try {
      const [pRes, mRes] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/models"),
      ]);
      if (!pRes.ok) throw new Error(`providers HTTP ${pRes.status}`);
      if (!mRes.ok) throw new Error(`models HTTP ${mRes.status}`);
      const providers = (await pRes.json()) as Provider[];
      const models = (await mRes.json()) as Model[];
      setState({ status: "ready", providers, models });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const providers = useMemo(
    () => (state.status === "ready" ? state.providers : []),
    [state]
  );
  const allModels = useMemo(
    () => (state.status === "ready" ? state.models : []),
    [state]
  );

  const resolvedId = useMemo(() => {
    if (selectedId && providers.some((p) => p.id === selectedId)) return selectedId;
    const fallback = providers.find((p) => p.is_default) ?? providers[0];
    return fallback?.id ?? "";
  }, [selectedId, providers]);

  const selected = providers.find((p) => p.id === resolvedId) ?? null;
  const providerModels = selected
    ? allModels.filter((m) => m.provider_id === selected.id)
    : [];

  const selectProvider = (id: string) => {
    const qs = new URLSearchParams(Array.from(params.entries()));
    qs.set("provider", id);
    router.replace(`/gateway?${qs.toString()}`);
  };

  async function handleCreateProvider() {
    if (!providerForm) return;
    setSaving(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerForm),
      });
      const created = (await res.json()) as Provider;
      setProviderForm(null);
      await load();
      if (created?.id) selectProvider(created.id);
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
      if (deleteProviderTarget.id === resolvedId) {
        const qs = new URLSearchParams(Array.from(params.entries()));
        qs.delete("provider");
        router.replace(`/gateway${qs.toString() ? `?${qs}` : ""}`);
      }
      await load();
    } finally {
      setDeleting(false);
    }
  }

  async function handleTestProvider(id: string) {
    setTests((p) => ({ ...p, [id]: { ok: false, msg: "连接中…" } }));
    const started = performance.now();
    const res = await fetch(`/api/providers/${id}/test`, { method: "POST" });
    const elapsed = Math.round(performance.now() - started);
    const data = (await res.json()) as {
      ok: boolean;
      endpoint?: string;
      status?: number;
      response?: string;
      error?: string;
    };
    const msg = data.ok
      ? data.endpoint
        ? `✓ 端点可达 · HTTP ${data.status} · ${elapsed} ms`
        : `✓ 端点可达 · ${elapsed} ms`
      : `✗ ${data.error ?? "失败"} · ${elapsed} ms`;
    setTests((p) => ({ ...p, [id]: { ok: data.ok, msg } }));
  }

  async function handleCreateModel() {
    if (!modelForm || !selected) return;
    setSaving(true);
    try {
      await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: selected.id, ...modelForm }),
      });
      setModelForm(null);
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
          onClick={() => setProviderForm({ ...EMPTY_PROVIDER_FORM })}
          className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover px-3 py-1.5 text-xs font-medium transition-colors"
        >
          + 添加供应商
        </button>
      }
    >
      <div className="h-full flex min-h-0">
        <ProviderRail
          state={state}
          resolvedId={resolvedId}
          tests={tests}
          onSelect={selectProvider}
          onRetry={load}
          onAddNew={() => setProviderForm({ ...EMPTY_PROVIDER_FORM })}
        />
        <section className="flex-1 min-w-0 overflow-y-auto">
          {state.status === "loading" && (
            <div data-testid="gateway-loading" className="h-full flex items-center justify-center">
              <div className="max-w-md w-full">
                <LoadingState title="加载供应商" />
              </div>
            </div>
          )}
          {state.status === "error" && (
            <ErrorPanel message={state.message} onRetry={() => void load()} />
          )}
          {state.status === "ready" && !selected && providers.length === 0 && (
            <Placeholder
              testid="gateway-empty"
              title="尚未配置任何供应商"
              body="添加 OpenAI / DeepSeek / Ollama / 本地 vLLM 等兼容端点即可开始。"
              action={{
                label: "添加第一个供应商 →",
                onClick: () => setProviderForm({ ...EMPTY_PROVIDER_FORM }),
              }}
            />
          )}
          {state.status === "ready" && selected && (
            <ProviderDetail
              provider={selected}
              models={providerModels}
              testResult={tests[selected.id]}
              onTest={() => void handleTestProvider(selected.id)}
              onSetDefault={() => void handleSetDefault(selected.id)}
              onDeleteProvider={() => setDeleteProviderTarget(selected)}
              onAddModel={() => setModelForm({ ...EMPTY_MODEL_FORM })}
              onTestModel={(m) => setChatModel(m)}
              onDeleteModel={(m) => setDeleteModelTarget(m)}
            />
          )}
        </section>
      </div>

      {providerForm !== null && (
        <ProviderFormDialog
          form={providerForm}
          onChange={setProviderForm}
          saving={saving}
          onCancel={() => setProviderForm(null)}
          onSave={() => void handleCreateProvider()}
        />
      )}
      {modelForm !== null && selected && (
        <ModelFormDialog
          providerName={selected.name}
          form={modelForm}
          onChange={setModelForm}
          saving={saving}
          onCancel={() => setModelForm(null)}
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

function ProviderRail({
  state,
  resolvedId,
  tests,
  onSelect,
  onRetry,
  onAddNew,
}: {
  state: LoadState;
  resolvedId: string;
  tests: Record<string, TestState>;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onAddNew: () => void;
}) {
  return (
    <aside className="w-72 shrink-0 border-r border-border bg-surface flex flex-col min-h-0">
      <div className="px-4 h-10 flex items-center justify-between border-b border-border">
        <span className="text-[11px] font-mono uppercase tracking-wider text-text-subtle">
          供应商 ({state.status === "ready" ? state.providers.length : "…"})
        </span>
        <button
          onClick={onAddNew}
          className="text-xs text-text-muted hover:text-text transition-colors"
          title="添加供应商"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {state.status === "loading" && (
          <div data-testid="providers-loading" className="px-3 py-4">
            <LoadingState title="加载供应商" />
          </div>
        )}
        {state.status === "error" && (
          <div data-testid="providers-error" className="px-4 py-4">
            <p className="text-xs text-danger mb-2">加载失败</p>
            <p className="text-[10px] font-mono text-text-muted mb-2 break-all">
              {state.message}
            </p>
            <button
              onClick={onRetry}
              className="text-xs rounded-md border border-border px-2 py-1 hover:bg-surface-2 text-text transition-colors"
            >
              重试
            </button>
          </div>
        )}
        {state.status === "ready" && state.providers.length === 0 && (
          <p
            data-testid="providers-empty"
            className="px-4 py-6 text-xs text-text-subtle text-center"
          >
            列表为空
          </p>
        )}
        <ul>
          {state.status === "ready" &&
            state.providers.map((p) => {
              const active = p.id === resolvedId;
              const test = tests[p.id];
              return (
                <li key={p.id}>
                  <button
                    onClick={() => onSelect(p.id)}
                    data-testid={`provider-rail-${p.name}`}
                    data-active={active}
                    className={`w-full text-left px-4 py-2 border-l-2 transition-colors ${
                      active
                        ? "border-l-primary bg-surface-2"
                        : "border-l-transparent hover:bg-surface-2/60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm truncate ${
                          active ? "text-text font-medium" : "text-text-muted"
                        }`}
                      >
                        {p.name}
                      </span>
                      {p.is_default && (
                        <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-primary/15 text-primary shrink-0">
                          默认
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-subtle">
                      <span
                        className={p.api_key_set ? "text-success" : "text-text-subtle"}
                      >
                        {p.api_key_set ? "● API Key" : "○ API Key"}
                      </span>
                      {test && (
                        <span
                          className={`truncate font-mono ${
                            test.ok ? "text-success" : "text-danger"
                          }`}
                        >
                          {test.msg.replace(/^[✓✗]\s*/, "")}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
        </ul>
      </div>
    </aside>
  );
}

function ProviderDetail({
  provider,
  models,
  testResult,
  onTest,
  onSetDefault,
  onDeleteProvider,
  onAddModel,
  onTestModel,
  onDeleteModel,
}: {
  provider: Provider;
  models: Model[];
  testResult?: TestState;
  onTest: () => void;
  onSetDefault: () => void;
  onDeleteProvider: () => void;
  onAddModel: () => void;
  onTestModel: (m: Model) => void;
  onDeleteModel: (m: Model) => void;
}) {
  return (
    <div className="max-w-3xl mx-auto px-8 py-6">
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-text">{provider.name}</h2>
          {provider.is_default && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
              默认
            </span>
          )}
          {!provider.enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
              已禁用
            </span>
          )}
        </div>
        <p className="text-xs font-mono text-text-subtle mt-1 truncate">
          {provider.base_url}
        </p>
        <p className="text-xs text-text-muted mt-2">
          API Key:{" "}
          <span className={provider.api_key_set ? "text-success" : "text-text-subtle"}>
            {provider.api_key_set ? "已设置" : "未设置"}
          </span>
          {" · "}
          默认模型: <span className="text-text">{provider.default_model}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            onClick={onTest}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
          >
            连通性测试
          </button>
          {!provider.is_default && (
            <button
              onClick={onSetDefault}
              className="text-xs px-2 py-1 rounded border border-border hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
            >
              设为默认
            </button>
          )}
          <button
            onClick={onDeleteProvider}
            className="text-xs px-2 py-1 rounded border border-border text-danger hover:bg-danger/10 transition-colors"
          >
            删除供应商
          </button>
        </div>
        {testResult && (
          <div
            className={`mt-2 text-xs px-3 py-1.5 rounded font-mono ${
              testResult.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
            }`}
          >
            {testResult.msg}
          </div>
        )}
        <p className="text-[11px] text-text-subtle mt-2">
          连通性测试只确认端点可达;模型具体能力请在下方“对话测试”中验证。
        </p>
      </header>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-text">
              模型 <span className="text-text-muted">({models.length})</span>
            </h3>
            <p className="text-[11px] text-text-subtle mt-0.5">
              对话测试以流式请求真实调用,展示延迟 / TTFT / tokens / tok·s⁻¹,失败会给出分类原因。
            </p>
          </div>
          <button
            onClick={onAddModel}
            className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover px-3 py-1.5 text-xs font-medium transition-colors"
          >
            + 注册模型
          </button>
        </div>

        {models.length === 0 ? (
          <div
            data-testid="models-empty"
            className="rounded-xl border border-dashed border-border p-8 text-center"
          >
            <p className="text-sm text-text-muted mb-2">
              此供应商下尚未注册任何模型
            </p>
            <button
              onClick={onAddModel}
              className="text-xs rounded-md bg-primary text-primary-fg hover:bg-primary-hover px-3 py-1.5 transition-colors"
            >
              注册第一个模型 →
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {models.map((m) => (
              <div
                key={m.id}
                className="rounded-xl border border-border bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text">
                        {m.display_name || m.name}
                      </span>
                      {!m.enabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                          已禁用
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-text-subtle truncate mt-0.5">
                      {m.name}
                    </p>
                    {m.context_window > 0 && (
                      <p className="text-[11px] text-text-muted mt-0.5">
                        上下文窗口: {m.context_window.toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onTestModel(m)}
                      className="text-xs px-2 py-1 rounded bg-primary text-primary-fg hover:bg-primary-hover transition-colors"
                    >
                      对话测试
                    </button>
                    <button
                      onClick={() => onDeleteModel(m)}
                      className="text-xs px-2 py-1 rounded border border-border text-danger hover:bg-danger/10 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Placeholder({
  title,
  body,
  action,
  testid,
}: {
  title?: string;
  body: string;
  action?: { label: string; onClick: () => void };
  testid?: string;
}) {
  return (
    <div className="h-full flex items-center justify-center">
      <div
        data-testid={testid}
        className="rounded-xl border border-dashed border-border p-10 text-center max-w-md"
      >
        {title && <p className="text-sm text-text mb-2">{title}</p>}
        <p className="text-sm text-text-muted mb-3">{body}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="text-xs rounded-md bg-primary text-primary-fg hover:bg-primary-hover px-3 py-1.5 transition-colors"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div
        data-testid="gateway-error"
        className="rounded-xl border border-danger/30 bg-danger/5 p-6 max-w-md"
      >
        <p className="text-sm text-danger mb-2">加载失败</p>
        <p className="text-xs text-text-muted mb-3 font-mono break-all">{message}</p>
        <button
          onClick={onRetry}
          className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors"
        >
          重试
        </button>
      </div>
    </div>
  );
}

function ProviderFormDialog({
  form,
  onChange,
  saving,
  onCancel,
  onSave,
}: {
  form: typeof EMPTY_PROVIDER_FORM;
  onChange: (f: typeof EMPTY_PROVIDER_FORM) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal onClose={onCancel} title="添加 LLM 供应商">
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
          label="API Key"
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
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.set_as_default}
            onChange={(e) => onChange({ ...form, set_as_default: e.target.checked })}
          />
          <span className="text-xs text-text-muted">设为默认供应商</span>
        </label>
        <DialogFooter
          saveLabel={saving ? "保存中…" : "保存"}
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
          onChange={(v) =>
            onChange({ ...form, context_window: Number(v) || 0 })
          }
        />
        <DialogFooter
          saveLabel={saving ? "保存中…" : "保存"}
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <button
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
    <div className="flex gap-2 pt-1">
      <button
        onClick={onSave}
        disabled={saveDisabled}
        className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
      >
        {saveLabel}
      </button>
      <button
        onClick={onCancel}
        className="rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
      >
        取消
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
        className={`w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
