"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Provider = {
  id: string;
  name: string;
  base_url: string;
  default_model: string;
  is_default: boolean;
};

type Model = {
  id: string;
  provider_id: string;
  name: string;
  display_name: string;
  context_window: number;
  enabled: boolean;
};

const EMPTY_FORM = { provider_id: "", name: "", display_name: "", context_window: 0 };

export default function ModelsPage() {
  return (
    <Suspense fallback={<AppShell title="模型网关 · 模型">{null}</AppShell>}>
      <ModelsPageInner />
    </Suspense>
  );
}

function ModelsPageInner() {
  const params = useSearchParams();
  const presetProvider = params.get("provider") ?? "";

  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [filter, setFilter] = useState<string>(presetProvider);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, provider_id: presetProvider });
  const [saving, setSaving] = useState(false);
  const [chatModel, setChatModel] = useState<Model | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<Model | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoadStatus("loading");
    try {
      const [pRes, mRes] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/models"),
      ]);
      if (!pRes.ok) throw new Error(`providers HTTP ${pRes.status}`);
      if (!mRes.ok) throw new Error(`models HTTP ${mRes.status}`);
      setProviders((await pRes.json()) as Provider[]);
      setModels((await mRes.json()) as Model[]);
      setLoadStatus("ready");
    } catch (err) {
      setLoadError(String(err));
      setLoadStatus("error");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredModels = filter
    ? models.filter((m) => m.provider_id === filter)
    : models;

  const providerById = (id: string) => providers.find((p) => p.id === id);

  async function handleCreate() {
    if (!form.provider_id || !form.name) return;
    setSaving(true);
    try {
      await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setShowForm(false);
      setForm({ ...EMPTY_FORM, provider_id: filter });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/models/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell
      title="模型网关 · 模型"
      actions={
        <button
          onClick={() => {
            setForm({ ...EMPTY_FORM, provider_id: filter || providers[0]?.id || "" });
            setShowForm(true);
          }}
          disabled={providers.length === 0}
          className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-3 py-1.5 text-xs font-medium transition-colors"
        >
          + 添加模型
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="mb-6 flex items-center justify-between gap-3">
            <p className="text-sm text-text-muted">
              第二步:为供应商注册具体模型并运行对话测试。
            </p>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-md bg-bg border border-border px-2 py-1 text-xs text-text"
            >
              <option value="">全部供应商</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {loadStatus === "loading" && (
            <div
              data-testid="models-loading"
              className="rounded-xl border border-border bg-surface p-10 text-center"
            >
              <p className="text-sm text-text-muted">加载中…</p>
            </div>
          )}

          {loadStatus === "error" && (
            <div
              data-testid="models-error"
              className="rounded-xl border border-danger/30 bg-danger/5 p-6"
            >
              <p className="text-sm text-danger mb-2">加载模型失败</p>
              <p className="text-xs text-text-muted mb-3 font-mono">{loadError}</p>
              <button
                onClick={() => void load()}
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors"
              >
                重试
              </button>
            </div>
          )}

          {loadStatus === "ready" && providers.length === 0 && (
            <div
              data-testid="models-needs-provider"
              className="rounded-xl border border-dashed border-border p-10 text-center"
            >
              <p className="text-sm text-text-muted mb-2">请先配置一个供应商</p>
              <Link
                href="/gateway/providers"
                className="text-xs text-primary hover:underline"
              >
                前往 供应商 →
              </Link>
            </div>
          )}

          {loadStatus === "ready" &&
            providers.length > 0 &&
            filteredModels.length === 0 &&
            !showForm && (
              <div
                data-testid="models-empty"
                className="rounded-xl border border-dashed border-border p-10 text-center"
              >
                <p className="text-sm text-text-muted mb-3">此范围下尚未注册任何模型</p>
                <button
                  onClick={() => {
                    setForm({
                      ...EMPTY_FORM,
                      provider_id: filter || providers[0]?.id || "",
                    });
                    setShowForm(true);
                  }}
                  className="text-xs rounded-md bg-primary text-primary-fg hover:bg-primary-hover px-3 py-1.5 transition-colors"
                >
                  注册第一个模型 →
                </button>
              </div>
            )}

          <div className="flex flex-col gap-2">
            {filteredModels.map((m) => {
              const prov = providerById(m.provider_id);
              return (
                <div
                  key={m.id}
                  className="rounded-xl border border-border bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-text">
                          {m.display_name || m.name}
                        </span>
                        {!m.enabled && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                            已禁用
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-text-subtle truncate">
                        {m.name}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        供应商: <span className="text-text">{prov?.name ?? m.provider_id}</span>
                        {m.context_window > 0 && (
                          <>
                            {" · "}
                            上下文窗口:{" "}
                            <span className="text-text">
                              {m.context_window.toLocaleString()}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setChatModel(m)}
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
                      >
                        对话测试
                      </button>
                      <button
                        onClick={() => setDeleteTarget(m)}
                        className="text-xs px-2 py-1 rounded border border-border text-danger hover:bg-danger/10 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {showForm && (
            <div className="mt-4 rounded-xl border border-border bg-surface p-5">
              <h3 className="text-sm font-semibold text-text mb-4">注册模型</h3>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs text-text-muted block mb-1">供应商</label>
                  <select
                    value={form.provider_id}
                    onChange={(e) => setForm({ ...form, provider_id: e.target.value })}
                    className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  label="模型名称 (API 调用值)"
                  mono
                  placeholder="gpt-4o-mini"
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                />
                <Field
                  label="显示名称 (可选)"
                  placeholder="GPT-4o Mini"
                  value={form.display_name}
                  onChange={(v) => setForm({ ...form, display_name: v })}
                />
                <Field
                  label="上下文窗口 (tokens,可选)"
                  placeholder="128000"
                  value={String(form.context_window || "")}
                  onChange={(v) =>
                    setForm({ ...form, context_window: Number(v) || 0 })
                  }
                />
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => void handleCreate()}
                    disabled={saving || !form.provider_id || !form.name}
                    className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {saving ? "保存中…" : "保存"}
                  </button>
                  <button
                    onClick={() => setShowForm(false)}
                    className="rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {chatModel && (
        <ChatTestDialog model={chatModel} onClose={() => setChatModel(null)} />
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除模型 ${deleteTarget?.display_name || deleteTarget?.name || ""}?`}
        message={"此操作不可撤销。已绑定该模型的员工将回退到供应商默认模型。"}
        confirmLabel="删除"
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteConfirmed()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1">{label}</label>
      <input
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

function ChatTestDialog({ model, onClose }: { model: Model; onClose: () => void }) {
  const [prompt, setPrompt] = useState("用一句话介绍你自己。");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/models/${model.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        response?: string;
        error?: string;
      };
      setResult({
        ok: data.ok,
        text: data.ok ? data.response ?? "" : data.error ?? "失败",
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text">
            对话测试 · {model.display_name || model.name}
          </h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text text-lg leading-none"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-text-subtle font-mono mb-3">{model.name}</p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-primary transition-colors resize-none"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => void run()}
            disabled={running || !prompt.trim()}
            className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
          >
            {running ? "请求中…" : "发送"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
          >
            关闭
          </button>
        </div>
        {result && (
          <div
            className={`mt-4 rounded-md border p-3 text-xs whitespace-pre-wrap ${
              result.ok
                ? "border-success/30 bg-success/5 text-text"
                : "border-danger/30 bg-danger/5 text-danger"
            }`}
          >
            {result.text}
          </div>
        )}
      </div>
    </div>
  );
}
