"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Provider = {
  id: string;
  name: string;
  base_url: string;
  api_key_set: boolean;
  default_model: string;
  is_default: boolean;
  enabled: boolean;
};

type TestResult = { ok: boolean; msg: string };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; providers: Provider[] }
  | { status: "error"; message: string };

async function fetchProviders(): Promise<Provider[]> {
  const res = await fetch("/api/providers");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const EMPTY_FORM = {
  name: "",
  base_url: "https://api.openai.com/v1",
  api_key: "",
  default_model: "gpt-4o-mini",
  set_as_default: false,
};

export default function ProvidersPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    try {
      const providers = await fetchProviders();
      setState({ status: "ready", providers });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const providers = state.status === "ready" ? state.providers : [];

  async function handleCreate() {
    setSaving(true);
    try {
      await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(id: string) {
    await fetch(`/api/providers/${id}/set-default`, { method: "POST" });
    await load();
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/providers/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  async function handleTest(id: string) {
    setTests((p) => ({ ...p, [id]: { ok: false, msg: "测试中…" } }));
    const res = await fetch(`/api/providers/${id}/test`, { method: "POST" });
    const data = (await res.json()) as {
      ok: boolean;
      endpoint?: string;
      status?: number;
      response?: string;
      error?: string;
    };
    const msg = data.ok
      ? data.endpoint
        ? `✓ 连通 (${data.status}) ${data.endpoint}`
        : `✓ 连通: ${data.response}`
      : `✗ ${data.error ?? "失败"}`;
    setTests((p) => ({ ...p, [id]: { ok: data.ok, msg } }));
  }

  return (
    <AppShell
      title="模型网关 · 供应商"
      actions={
        <button
          onClick={() => setShowForm(true)}
          className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover px-3 py-1.5 text-xs font-medium transition-colors"
        >
          + 添加供应商
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="mb-6">
            <p className="text-sm text-text-muted">
              第一步:配置一个 OpenAI 兼容的端点。然后在「模型」里为此供应商注册
              模型并测试对话。
            </p>
          </div>

          {state.status === "loading" && (
            <div
              data-testid="providers-loading"
              className="rounded-xl border border-border bg-surface p-10 text-center"
            >
              <p className="text-sm text-text-muted">加载中…</p>
            </div>
          )}

          {state.status === "error" && (
            <div
              data-testid="providers-error"
              className="rounded-xl border border-danger/30 bg-danger/5 p-6"
            >
              <p className="text-sm text-danger mb-2">加载供应商失败</p>
              <p className="text-xs text-text-muted mb-3 font-mono">{state.message}</p>
              <button
                onClick={() => void load()}
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors"
              >
                重试
              </button>
            </div>
          )}

          {state.status === "ready" && providers.length === 0 && !showForm && (
            <div
              data-testid="providers-empty"
              className="rounded-xl border border-dashed border-border p-10 text-center"
            >
              <p className="text-sm text-text-muted mb-2">尚未配置任何供应商</p>
              <p className="text-xs text-text-subtle mb-4">
                添加 OpenAI / DeepSeek / Ollama / 本地 vLLM 等兼容端点即可开始。
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="text-xs rounded-md bg-primary text-primary-fg hover:bg-primary-hover px-3 py-1.5 transition-colors"
              >
                添加第一个供应商 →
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {providers.map((p) => (
              <div
                key={p.id}
                data-testid={`provider-${p.name}`}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-text">{p.name}</span>
                      {p.is_default && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                          默认
                        </span>
                      )}
                      {!p.enabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                          已禁用
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-text-subtle truncate">
                      {p.base_url}
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      API Key:{" "}
                      <span className={p.api_key_set ? "text-success" : "text-text-subtle"}>
                        {p.api_key_set ? "已设置" : "未设置"}
                      </span>
                      {" · "}
                      默认模型: <span className="text-text">{p.default_model}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => void handleTest(p.id)}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
                    >
                      连通性测试
                    </button>
                    <Link
                      href={`/gateway/models?provider=${p.id}`}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
                    >
                      管理模型
                    </Link>
                    {!p.is_default && (
                      <button
                        onClick={() => void handleSetDefault(p.id)}
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
                      >
                        设为默认
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteTarget(p)}
                      className="text-xs px-2 py-1 rounded border border-border text-danger hover:bg-danger/10 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
                {tests[p.id] !== undefined && (
                  <div
                    className={`mt-2 text-xs px-3 py-1.5 rounded ${
                      tests[p.id]!.ok
                        ? "bg-success/10 text-success"
                        : "bg-danger/10 text-danger"
                    }`}
                  >
                    {tests[p.id]!.msg}
                  </div>
                )}
              </div>
            ))}
          </div>

          {showForm && (
            <div className="mt-4 rounded-xl border border-border bg-surface p-5">
              <h3 className="text-sm font-semibold text-text mb-4">
                添加 LLM 供应商
              </h3>
              <div className="flex flex-col gap-3">
                <LabeledInput
                  label="名称"
                  placeholder="例: OpenAI / DeepSeek / 本地 Ollama"
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                />
                <LabeledInput
                  label="Base URL"
                  placeholder="https://api.openai.com/v1"
                  mono
                  value={form.base_url}
                  onChange={(v) => setForm({ ...form, base_url: v })}
                />
                <LabeledInput
                  label="API Key"
                  type="password"
                  placeholder="sk-... (本地部署可留空)"
                  value={form.api_key}
                  onChange={(v) => setForm({ ...form, api_key: v })}
                />
                <LabeledInput
                  label="默认模型"
                  mono
                  placeholder="gpt-4o-mini"
                  value={form.default_model}
                  onChange={(v) => setForm({ ...form, default_model: v })}
                />
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.set_as_default}
                    onChange={(e) =>
                      setForm({ ...form, set_as_default: e.target.checked })
                    }
                  />
                  <span className="text-xs text-text-muted">设为默认供应商</span>
                </label>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => void handleCreate()}
                    disabled={saving || !form.name || !form.base_url}
                    className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {saving ? "保存中…" : "保存"}
                  </button>
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setForm(EMPTY_FORM);
                    }}
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
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除供应商 ${deleteTarget?.name ?? ""}?`}
        message={"此操作不可撤销。其下注册的所有模型会一并删除。\n\n建议先把依赖它的员工迁移到其它供应商。"}
        confirmLabel="删除"
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteConfirmed()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
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
