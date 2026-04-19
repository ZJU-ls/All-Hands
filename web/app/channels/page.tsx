"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type ChannelKind = "telegram" | "bark" | "wecom" | "feishu" | "email" | "pushdeer";

type Channel = {
  id: string;
  kind: ChannelKind;
  display_name: string;
  config: Record<string, unknown>;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  auto_approve_outbound: boolean;
  webhook_secret: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

const KIND_LABEL: Record<ChannelKind, string> = {
  telegram: "Telegram",
  bark: "Bark (iOS)",
  wecom: "企业微信",
  feishu: "飞书",
  email: "邮件 (SMTP)",
  pushdeer: "PushDeer",
};

const KIND_HINT: Record<ChannelKind, string> = {
  telegram: "bot_token + chat_id · 双向",
  bark: "device_key · 单向 iOS 推送",
  wecom: "corp_id + corp_secret + agent_id · v0 stub",
  feishu: "webhook_url + signing_secret · v0 stub",
  email: "SMTP host/port/credentials · v0 stub",
  pushdeer: "push_key · v0 stub",
};

const KIND_CONFIG_FIELDS: Record<ChannelKind, string[]> = {
  telegram: ["bot_token", "chat_id"],
  bark: ["device_key", "server_url"],
  wecom: ["corp_id", "corp_secret", "agent_id", "to_user"],
  feishu: ["webhook_url", "signing_secret"],
  email: ["smtp_host", "smtp_port", "username", "password", "from_addr", "to_addr"],
  pushdeer: ["push_key", "server_url"],
};

const KINDS: ChannelKind[] = ["telegram", "bark", "wecom", "feishu", "email", "pushdeer"];

type CreateDraft = {
  kind: ChannelKind;
  display_name: string;
  config: Record<string, string>;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  auto_approve_outbound: boolean;
  webhook_secret: string;
};

function emptyDraft(kind: ChannelKind = "telegram"): CreateDraft {
  const config: Record<string, string> = {};
  for (const f of KIND_CONFIG_FIELDS[kind]) config[f] = "";
  return {
    kind,
    display_name: "",
    config,
    inbound_enabled: kind === "telegram",
    outbound_enabled: true,
    auto_approve_outbound: false,
    webhook_secret: "",
  };
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testingId, setTestingId] = useState<string>("");
  const [testResult, setTestResult] = useState<
    Record<string, { ok: boolean; detail: string; latency_ms: number }>
  >({});

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/channels");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setChannels((await res.json()) as Channel[]);
      setStatus("ready");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTest(ch: Channel) {
    setTestingId(ch.id);
    try {
      const res = await fetch(`/api/channels/${ch.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult((prev) => ({ ...prev, [ch.id]: data }));
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [ch.id]: { ok: false, detail: String(err), latency_ms: 0 },
      }));
    } finally {
      setTestingId("");
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/channels/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell
      title="通知渠道"
      actions={
        <button
          onClick={() => setDrawerOpen(true)}
          data-testid="new-channel"
          className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-fg hover:bg-primary-hover transition-colors duration-base"
        >
          + 注册渠道
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <p className="mb-6 text-sm text-text-muted">
            平台级通知渠道:任何 skill / trigger / agent 调用{" "}
            <code className="text-xs font-mono">send_notification</code> 即可触达用户。Telegram 与 Bark 为 v0 真实可用渠道;其他为 stub,仅接受注册不发送。
          </p>

          {status === "loading" && (
            <div data-testid="channels-loading">
              <LoadingState title="加载渠道" />
            </div>
          )}

          {status === "error" && (
            <div
              data-testid="channels-error"
              className="rounded-xl border border-danger/30 bg-danger/5 p-6"
            >
              <p className="text-sm text-danger mb-2">加载渠道失败</p>
              <p className="text-xs text-text-muted mb-3 font-mono">{error}</p>
              <button
                onClick={load}
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-border-strong transition-colors duration-base"
              >
                重试
              </button>
            </div>
          )}

          {status === "ready" && channels.length === 0 && (
            <div
              data-testid="channels-empty"
              className="rounded-xl border border-border bg-surface p-10 text-center"
            >
              <p className="text-sm text-text-muted mb-1">还没有注册任何渠道</p>
              <p className="text-xs text-text-subtle">
                点右上角注册 · 或在对话里让 Lead Agent 用{" "}
                <code className="font-mono">register_channel</code> Meta Tool 代办
              </p>
            </div>
          )}

          {status === "ready" && channels.length > 0 && (
            <ul className="space-y-3" data-testid="channels-list">
              {channels.map((ch) => (
                <li
                  key={ch.id}
                  className="rounded-xl border border-border bg-surface hover:border-border-strong transition-colors duration-base"
                >
                  <div className="px-4 py-3 flex items-center gap-4">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        ch.enabled ? "bg-success" : "bg-text-subtle"
                      }`}
                      aria-label={ch.enabled ? "启用" : "停用"}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/channels/${ch.id}`}
                          className="text-sm font-medium text-text hover:text-primary transition-colors duration-base truncate"
                        >
                          {ch.display_name}
                        </Link>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-mono">
                          {KIND_LABEL[ch.kind]}
                        </span>
                        {ch.inbound_enabled && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                            ← in
                          </span>
                        )}
                        {ch.outbound_enabled && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                            → out
                          </span>
                        )}
                        {ch.auto_approve_outbound && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-success/10 text-success">
                            自动批准
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-subtle mt-0.5 font-mono truncate">
                        {ch.id}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {testResult[ch.id] !== undefined &&
                        (() => {
                          const tr = testResult[ch.id]!;
                          return (
                            <span
                              className={`text-[11px] font-mono ${
                                tr.ok ? "text-success" : "text-danger"
                              }`}
                            >
                              {tr.ok ? `ok · ${tr.latency_ms}ms` : "fail"}
                            </span>
                          );
                        })()}
                      <button
                        onClick={() => handleTest(ch)}
                        disabled={testingId === ch.id}
                        className="text-xs px-2.5 py-1 rounded-md border border-border hover:border-border-strong transition-colors duration-base disabled:opacity-50"
                      >
                        {testingId === ch.id ? "…" : "测试"}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(ch)}
                        className="text-xs px-2.5 py-1 rounded-md border border-border text-danger hover:border-danger transition-colors duration-base"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {drawerOpen && (
        <CreateDrawer
          onClose={() => setDrawerOpen(false)}
          onCreated={async () => {
            setDrawerOpen(false);
            await load();
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除渠道?"
        message={
          deleteTarget
            ? `该操作不可撤销。渠道 ${deleteTarget.display_name} 的订阅和消息审计都会被级联删除。`
            : ""
        }
        confirmLabel={deleting ? "删除中…" : "删除"}
        cancelLabel="取消"
        danger
        busy={deleting}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}

function CreateDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft("telegram"));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  function setKind(kind: ChannelKind) {
    setDraft(emptyDraft(kind));
  }

  async function handleSubmit() {
    setErr("");
    if (!draft.display_name.trim()) {
      setErr("请填 display_name");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: draft.kind,
          display_name: draft.display_name,
          config: draft.config,
          inbound_enabled: draft.inbound_enabled,
          outbound_enabled: draft.outbound_enabled,
          auto_approve_outbound: draft.auto_approve_outbound,
          webhook_secret: draft.webhook_secret || null,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      await onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex justify-end"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md bg-bg border-l border-border overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-medium text-text">注册新渠道</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors duration-base text-sm"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs text-text-muted block mb-1.5">Kind</label>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`text-left px-3 py-2 rounded-md border transition-colors duration-base ${
                    draft.kind === k
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border-strong"
                  }`}
                >
                  <p className="text-xs text-text font-medium">{KIND_LABEL[k]}</p>
                  <p className="text-[11px] text-text-subtle mt-0.5">{KIND_HINT[k]}</p>
                </button>
              ))}
            </div>
          </div>
          <FormField
            label="显示名称"
            value={draft.display_name}
            onChange={(v) => setDraft((d) => ({ ...d, display_name: v }))}
            placeholder="例如:我的 Telegram Bot"
          />
          {KIND_CONFIG_FIELDS[draft.kind].map((field) => (
            <FormField
              key={field}
              label={`config.${field}`}
              value={draft.config[field] ?? ""}
              onChange={(v) =>
                setDraft((d) => ({ ...d, config: { ...d.config, [field]: v } }))
              }
              mono
            />
          ))}
          <FormField
            label="webhook_secret (可选)"
            value={draft.webhook_secret}
            onChange={(v) => setDraft((d) => ({ ...d, webhook_secret: v }))}
            mono
          />
          <ToggleRow
            label="接收入站消息 (inbound)"
            checked={draft.inbound_enabled}
            onChange={(v) => setDraft((d) => ({ ...d, inbound_enabled: v }))}
          />
          <ToggleRow
            label="可出站 (outbound)"
            checked={draft.outbound_enabled}
            onChange={(v) => setDraft((d) => ({ ...d, outbound_enabled: v }))}
          />
          <ToggleRow
            label="自动批准出站 (跳过 ConfirmationGate)"
            checked={draft.auto_approve_outbound}
            onChange={(v) => setDraft((d) => ({ ...d, auto_approve_outbound: v }))}
          />
          {err && (
            <p className="text-xs text-danger font-mono break-all">{err}</p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-border flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-border-strong transition-colors duration-base"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-fg hover:bg-primary-hover transition-colors duration-base disabled:opacity-50"
          >
            {submitting ? "创建中…" : "创建渠道"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 text-xs bg-surface border border-border rounded-md hover:border-border-strong focus:border-primary focus:outline-none transition-colors duration-base ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between py-1">
      <span className="text-xs text-text">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}
