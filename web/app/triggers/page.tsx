"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Kind = "timer" | "event";

type ActionType = "notify_user" | "invoke_tool" | "dispatch_employee" | "continue_conversation";

type Trigger = {
  id: string;
  name: string;
  kind: Kind;
  enabled: boolean;
  timer: { cron: string; timezone: string } | null;
  event: { type: string; filter: Record<string, unknown> } | null;
  action: {
    type: ActionType;
    employee_id: string | null;
    task_template: string | null;
    conversation_id: string | null;
    message_template: string | null;
    tool_id: string | null;
    args_template: Record<string, unknown> | null;
    channel: string | null;
    message: string | null;
  };
  min_interval_seconds: number;
  fires_total: number;
  fires_failed_streak: number;
  last_fired_at: string | null;
  auto_disabled_reason: string | null;
  created_at: string;
  created_by: string;
};

type CreateDraft = {
  name: string;
  kind: Kind;
  cron: string;
  timezone: string;
  event_type: string;
  action_type: ActionType;
  message: string;
  tool_id: string;
  employee_id: string;
  task_template: string;
  conversation_id: string;
  message_template: string;
  min_interval_seconds: number;
};

const EMPTY_DRAFT: CreateDraft = {
  name: "",
  kind: "timer",
  cron: "0 8 * * *",
  timezone: "UTC",
  event_type: "",
  action_type: "notify_user",
  message: "",
  tool_id: "",
  employee_id: "",
  task_template: "",
  conversation_id: "",
  message_template: "",
  min_interval_seconds: 300,
};

export default function TriggersPage() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Trigger | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string>("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/triggers");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTriggers((await res.json()) as Trigger[]);
      setStatus("ready");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(t: Trigger) {
    setBusyId(t.id);
    try {
      const res = await fetch(`/api/triggers/${t.id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !t.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId("");
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/triggers/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell
      title="触发器"
      actions={
        <button
          onClick={() => setDrawerOpen(true)}
          data-testid="new-trigger"
          className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-fg hover:bg-primary-hover transition-colors duration-base"
        >
          + 新触发器
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <p className="mb-6 text-sm text-text-muted">
            按时间表(cron)或事件匹配(event pattern)自动执行动作。创建 / 启停 / 手动触发 / 删除都可以在对话里让 Lead Agent 代办。
          </p>

          {status === "loading" && (
            <div
              data-testid="triggers-loading"
              className="rounded-xl border border-border bg-surface p-10 text-center"
            >
              <p className="text-sm text-text-muted">加载中…</p>
            </div>
          )}

          {status === "error" && (
            <div
              data-testid="triggers-error"
              className="rounded-xl border border-danger/30 bg-danger/5 p-6"
            >
              <p className="text-sm text-danger mb-2">加载触发器失败</p>
              <p className="text-xs text-text-muted mb-3 font-mono">{error}</p>
              <button
                onClick={() => void load()}
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors duration-base"
              >
                重试
              </button>
            </div>
          )}

          {status === "ready" && triggers.length === 0 && (
            <div
              data-testid="triggers-empty"
              className="rounded-xl border border-dashed border-border p-10 text-center"
            >
              <p className="text-sm text-text-muted mb-2">
                还没有触发器。
              </p>
              <p className="text-xs text-text-subtle">
                用右上&ldquo;+ 新触发器&rdquo;开始,或直接对 Lead Agent 说&ldquo;帮我每天早上 8 点通知今日日程&rdquo;。
              </p>
            </div>
          )}

          {status === "ready" && triggers.length > 0 && (
            <div data-testid="triggers-list" className="flex flex-col gap-2">
              {triggers.map((t) => (
                <TriggerRow
                  key={t.id}
                  t={t}
                  busy={busyId === t.id}
                  onToggle={() => void handleToggle(t)}
                  onDelete={() => setDeleteTarget(t)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={async () => {
          setDrawerOpen(false);
          await load();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除触发器 ${deleteTarget?.name ?? ""}?`}
        message="此操作同时删除所有触发历史,不可撤销。"
        confirmLabel="删除"
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteConfirmed()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}

function StatusDot({ t }: { t: Trigger }) {
  if (t.auto_disabled_reason) {
    return (
      <span
        title={`auto-disabled: ${t.auto_disabled_reason}`}
        className="inline-block h-2 w-2 rounded-full bg-warning"
        aria-label="auto-disabled"
      />
    );
  }
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${t.enabled ? "bg-success" : "bg-border-strong"}`}
      aria-label={t.enabled ? "enabled" : "disabled"}
    />
  );
}

function TriggerRow({
  t,
  busy,
  onToggle,
  onDelete,
}: {
  t: Trigger;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const subtitle =
    t.kind === "timer"
      ? `cron ${t.timer?.cron ?? ""} · ${t.timer?.timezone ?? "UTC"}`
      : `event ${t.event?.type ?? ""}`;

  return (
    <div
      data-testid={`trigger-${t.id}`}
      className="rounded-xl border border-border bg-surface p-4 hover:border-border-strong transition-colors duration-base"
    >
      <div className="flex items-start justify-between gap-3">
        <Link href={`/triggers/${t.id}`} className="flex-1 min-w-0 group">
          <div className="flex items-center gap-2 mb-1">
            <StatusDot t={t} />
            <span className="text-sm font-medium text-text group-hover:text-primary transition-colors duration-base">
              {t.name}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
              {t.kind}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
              {t.action.type}
            </span>
          </div>
          <p className="text-xs font-mono text-text-subtle truncate">{subtitle}</p>
          <p className="text-[11px] text-text-muted mt-1">
            今日触发 {t.fires_total} 次
            {t.last_fired_at ? ` · 最近 ${formatTime(t.last_fired_at)}` : " · 尚未触发"}
            {t.fires_failed_streak > 0 ? ` · 连续失败 ${t.fires_failed_streak}` : ""}
          </p>
        </Link>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={onToggle}
            disabled={busy}
            data-testid={`toggle-${t.id}`}
            className="text-xs px-3 py-1.5 rounded-md border border-border text-text hover:bg-surface-2 disabled:opacity-40 transition-colors duration-base"
          >
            {busy ? "…" : t.enabled ? "停用" : "启用"}
          </button>
          <button
            onClick={onDelete}
            data-testid={`delete-${t.id}`}
            className="text-xs px-3 py-1.5 rounded-md border border-border text-danger hover:bg-danger/10 transition-colors duration-base"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(EMPTY_DRAFT);
    setErr("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function buildBody(): Record<string, unknown> {
    const action: Record<string, unknown> = { type: draft.action_type };
    if (draft.action_type === "notify_user") {
      action.message = draft.message;
      action.channel = "cockpit";
    } else if (draft.action_type === "invoke_tool") {
      action.tool_id = draft.tool_id;
    } else if (draft.action_type === "dispatch_employee") {
      action.employee_id = draft.employee_id;
      action.task_template = draft.task_template;
    } else {
      action.conversation_id = draft.conversation_id;
      action.message_template = draft.message_template;
    }
    const body: Record<string, unknown> = {
      name: draft.name,
      kind: draft.kind,
      action,
      min_interval_seconds: draft.min_interval_seconds,
    };
    if (draft.kind === "timer") {
      body.timer = { cron: draft.cron, timezone: draft.timezone };
    } else {
      body.event = { type: draft.event_type, filter: {} };
    }
    return body;
  }

  async function submit() {
    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch("/api/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(detail.detail || `HTTP ${res.status}`);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-trigger-title"
      onClick={onClose}
    >
      <div
        data-testid="create-drawer"
        className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3
            id="create-trigger-title"
            className="text-sm font-semibold text-text"
          >
            新建触发器
          </h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="text-xs text-text-muted hover:text-text transition-colors duration-base"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <Field
            label="名称"
            value={draft.name}
            onChange={(v) => setDraft({ ...draft, name: v })}
            placeholder="每日日报"
          />

          <div>
            <label className="text-xs text-text-muted block mb-1.5">类型</label>
            <div className="flex gap-2">
              {(["timer", "event"] as Kind[]).map((k) => (
                <button
                  key={k}
                  data-testid={`kind-${k}`}
                  onClick={() => setDraft({ ...draft, kind: k })}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors duration-base ${
                    draft.kind === k
                      ? "border-primary text-text bg-surface-2"
                      : "border-border text-text-muted hover:text-text"
                  }`}
                >
                  {k === "timer" ? "Timer · cron" : "Event · 事件匹配"}
                </button>
              ))}
            </div>
          </div>

          {draft.kind === "timer" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="cron 表达式"
                mono
                value={draft.cron}
                onChange={(v) => setDraft({ ...draft, cron: v })}
                placeholder="0 8 * * *"
              />
              <Field
                label="时区"
                mono
                value={draft.timezone}
                onChange={(v) => setDraft({ ...draft, timezone: v })}
                placeholder="UTC"
              />
            </div>
          ) : (
            <Field
              label="事件类型"
              mono
              value={draft.event_type}
              onChange={(v) => setDraft({ ...draft, event_type: v })}
              placeholder="artifact.updated"
            />
          )}

          <div>
            <label className="text-xs text-text-muted block mb-1.5">动作</label>
            <select
              value={draft.action_type}
              onChange={(e) =>
                setDraft({ ...draft, action_type: e.target.value as ActionType })
              }
              data-testid="action-type"
              className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-primary transition-colors duration-base"
            >
              <option value="notify_user">通知用户 · notify_user</option>
              <option value="invoke_tool">调用 Tool · invoke_tool</option>
              <option value="dispatch_employee">派发员工 · dispatch_employee</option>
              <option value="continue_conversation">续会话 · continue_conversation</option>
            </select>
          </div>

          {draft.action_type === "notify_user" && (
            <Field
              label="消息模板(支持 {{event.*}} / {{@today}})"
              value={draft.message}
              onChange={(v) => setDraft({ ...draft, message: v })}
              placeholder="今日日程已生成"
            />
          )}
          {draft.action_type === "invoke_tool" && (
            <Field
              label="Tool ID"
              mono
              value={draft.tool_id}
              onChange={(v) => setDraft({ ...draft, tool_id: v })}
              placeholder="allhands.builtin.fetch_url"
            />
          )}
          {draft.action_type === "dispatch_employee" && (
            <>
              <Field
                label="员工 ID"
                mono
                value={draft.employee_id}
                onChange={(v) => setDraft({ ...draft, employee_id: v })}
                placeholder="emp_xxx"
              />
              <Field
                label="任务模板"
                value={draft.task_template}
                onChange={(v) => setDraft({ ...draft, task_template: v })}
                placeholder="汇总 {{@yesterday}} 的所有 artifact"
              />
            </>
          )}
          {draft.action_type === "continue_conversation" && (
            <>
              <Field
                label="会话 ID"
                mono
                value={draft.conversation_id}
                onChange={(v) => setDraft({ ...draft, conversation_id: v })}
                placeholder="conv_xxx"
              />
              <Field
                label="消息模板"
                value={draft.message_template}
                onChange={(v) => setDraft({ ...draft, message_template: v })}
                placeholder="请更新进展"
              />
            </>
          )}

          <div>
            <label className="text-xs text-text-muted block mb-1">
              最小触发间隔(秒,≥ 60)
            </label>
            <input
              type="number"
              min={60}
              value={draft.min_interval_seconds}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  min_interval_seconds: Number(e.target.value) || 60,
                })
              }
              className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-primary transition-colors duration-base"
            />
          </div>

          {err && (
            <p className="text-xs text-danger font-mono" data-testid="create-error">
              {err}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:text-text transition-colors duration-base"
          >
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !draft.name.trim()}
            data-testid="create-submit"
            className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors duration-base"
          >
            {submitting ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
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
        className={`w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors duration-base ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
