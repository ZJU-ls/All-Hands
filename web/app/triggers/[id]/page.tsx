"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
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

type Fire = {
  id: string;
  trigger_id: string;
  fired_at: string;
  source: string;
  status: string;
  run_id: string | null;
  rendered_task: string | null;
  error_code: string | null;
  error_detail: string | null;
};

export default function TriggerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [fires, setFires] = useState<Fire[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "notfound">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"toggle" | "fire" | "">("");
  const [confirmFire, setConfirmFire] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setStatus("loading");
    try {
      const [tRes, fRes] = await Promise.all([
        fetch(`/api/triggers/${id}`),
        fetch(`/api/triggers/${id}/fires?limit=50`),
      ]);
      if (tRes.status === 404) {
        setStatus("notfound");
        return;
      }
      if (!tRes.ok) throw new Error(`trigger HTTP ${tRes.status}`);
      if (!fRes.ok) throw new Error(`fires HTTP ${fRes.status}`);
      setTrigger((await tRes.json()) as Trigger);
      setFires((await fRes.json()) as Fire[]);
      setStatus("ready");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle() {
    if (!trigger) return;
    setBusy("toggle");
    try {
      const res = await fetch(`/api/triggers/${trigger.id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !trigger.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }

  async function handleFireNow() {
    if (!trigger) return;
    setBusy("fire");
    try {
      const res = await fetch(`/api/triggers/${trigger.id}/fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(detail.detail || `HTTP ${res.status}`);
      }
      setConfirmFire(false);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }

  async function handleDelete() {
    if (!trigger) return;
    try {
      await fetch(`/api/triggers/${trigger.id}`, { method: "DELETE" });
      window.location.href = "/triggers";
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <AppShell title={trigger?.name ?? "触发器"}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <div className="mb-4">
            <Link
              href="/triggers"
              className="text-xs text-text-muted hover:text-text transition-colors duration-base"
            >
              ← 返回列表
            </Link>
          </div>

          {status === "loading" && (
            <div
              data-testid="detail-loading"
              className="rounded-xl border border-border bg-surface p-10 text-center"
            >
              <p className="text-sm text-text-muted">加载中…</p>
            </div>
          )}

          {status === "notfound" && (
            <div
              data-testid="detail-notfound"
              className="rounded-xl border border-dashed border-border p-10 text-center"
            >
              <p className="text-sm text-text-muted mb-2">触发器不存在或已被删除</p>
              <p className="text-xs font-mono text-text-subtle">{id}</p>
            </div>
          )}

          {status === "error" && (
            <div
              data-testid="detail-error"
              className="rounded-xl border border-danger/30 bg-danger/5 p-6"
            >
              <p className="text-sm text-danger mb-2">加载失败</p>
              <p className="text-xs text-text-muted mb-3 font-mono">{error}</p>
              <button
                onClick={() => void load()}
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors duration-base"
              >
                重试
              </button>
            </div>
          )}

          {status === "ready" && trigger && (
            <>
              <Header
                t={trigger}
                busy={busy}
                onToggle={() => void handleToggle()}
                onFire={() => setConfirmFire(true)}
                onDelete={() => setConfirmDelete(true)}
              />

              {trigger.auto_disabled_reason && (
                <div className="mb-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
                  <p className="text-xs text-warning font-medium mb-1">自动停用</p>
                  <p className="text-xs text-text-muted">{trigger.auto_disabled_reason}</p>
                  <p className="text-[11px] text-text-subtle mt-1">
                    手动启用会清空失败计数。
                  </p>
                </div>
              )}

              <Section title="触发条件">
                {trigger.kind === "timer" ? (
                  <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs">
                    <dt className="text-text-muted">cron</dt>
                    <dd className="font-mono text-text">{trigger.timer?.cron}</dd>
                    <dt className="text-text-muted">时区</dt>
                    <dd className="font-mono text-text">{trigger.timer?.timezone}</dd>
                    <dt className="text-text-muted">最小间隔</dt>
                    <dd className="font-mono text-text">
                      {trigger.min_interval_seconds} s
                    </dd>
                  </dl>
                ) : (
                  <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs">
                    <dt className="text-text-muted">event kind</dt>
                    <dd className="font-mono text-text">{trigger.event?.type}</dd>
                    <dt className="text-text-muted">filter</dt>
                    <dd className="font-mono text-text-muted break-all">
                      {JSON.stringify(trigger.event?.filter ?? {})}
                    </dd>
                    <dt className="text-text-muted">最小间隔</dt>
                    <dd className="font-mono text-text">
                      {trigger.min_interval_seconds} s
                    </dd>
                  </dl>
                )}
              </Section>

              <Section title="动作">
                <ActionPreview t={trigger} />
              </Section>

              <Section title={`最近触发记录 · ${fires.length}`}>
                {fires.length === 0 ? (
                  <p
                    data-testid="fires-empty"
                    className="text-xs text-text-muted"
                  >
                    还没有触发记录。
                  </p>
                ) : (
                  <div
                    data-testid="fires-list"
                    className="flex flex-col gap-1.5"
                  >
                    {fires.map((f) => (
                      <FireRow key={f.id} f={f} />
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmFire}
        title={`手动触发 ${trigger?.name ?? ""}?`}
        message="会立即执行一次。5 条防爆规则(paused / rate-limit / cycle / global-limit)仍然生效。"
        confirmLabel="触发"
        busy={busy === "fire"}
        onConfirm={() => void handleFireNow()}
        onCancel={() => setConfirmFire(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`删除触发器 ${trigger?.name ?? ""}?`}
        message="此操作同时删除所有触发历史,不可撤销。"
        confirmLabel="删除"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </AppShell>
  );
}

function Header({
  t,
  busy,
  onToggle,
  onFire,
  onDelete,
}: {
  t: Trigger;
  busy: "toggle" | "fire" | "";
  onToggle: () => void;
  onFire: () => void;
  onDelete: () => void;
}) {
  const dotClass = t.auto_disabled_reason
    ? "bg-warning"
    : t.enabled
      ? "bg-success"
      : "bg-border-strong";
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
          <h2 className="text-lg font-semibold text-text truncate">{t.name}</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
            {t.kind}
          </span>
        </div>
        <p className="text-xs text-text-muted">
          {t.fires_total} 次触发
          {t.fires_failed_streak > 0 ? ` · 连续失败 ${t.fires_failed_streak}` : ""}
          {t.last_fired_at ? ` · 最近 ${formatTime(t.last_fired_at)}` : " · 尚未触发"}
        </p>
        <p className="text-[11px] font-mono text-text-subtle mt-1">{t.id}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onFire}
          disabled={busy !== ""}
          data-testid="fire-now"
          className="text-xs px-3 py-1.5 rounded-md border border-border text-text hover:bg-surface-2 disabled:opacity-40 transition-colors duration-base"
        >
          手动触发
        </button>
        <button
          onClick={onToggle}
          disabled={busy !== ""}
          data-testid="toggle"
          className="text-xs px-3 py-1.5 rounded-md border border-border text-text hover:bg-surface-2 disabled:opacity-40 transition-colors duration-base"
        >
          {busy === "toggle" ? "…" : t.enabled ? "停用" : "启用"}
        </button>
        <button
          onClick={onDelete}
          data-testid="delete"
          className="text-xs px-3 py-1.5 rounded-md border border-border text-danger hover:bg-danger/10 transition-colors duration-base"
        >
          删除
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-border bg-surface p-5">
      <h3 className="text-[11px] uppercase tracking-wide text-text-subtle mb-3 font-mono">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ActionPreview({ t }: { t: Trigger }) {
  const a = t.action;
  if (a.type === "notify_user") {
    return (
      <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs">
        <dt className="text-text-muted">类型</dt>
        <dd className="font-mono text-text">notify_user</dd>
        <dt className="text-text-muted">channel</dt>
        <dd className="font-mono text-text">{a.channel ?? "cockpit"}</dd>
        <dt className="text-text-muted">消息模板</dt>
        <dd className="text-text whitespace-pre-wrap">{a.message ?? "—"}</dd>
      </dl>
    );
  }
  if (a.type === "invoke_tool") {
    return (
      <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs">
        <dt className="text-text-muted">类型</dt>
        <dd className="font-mono text-text">invoke_tool</dd>
        <dt className="text-text-muted">tool_id</dt>
        <dd className="font-mono text-text">{a.tool_id ?? "—"}</dd>
        <dt className="text-text-muted">args</dt>
        <dd className="font-mono text-text-muted break-all">
          {JSON.stringify(a.args_template ?? {})}
        </dd>
      </dl>
    );
  }
  if (a.type === "dispatch_employee") {
    return (
      <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs">
        <dt className="text-text-muted">类型</dt>
        <dd className="font-mono text-text">dispatch_employee</dd>
        <dt className="text-text-muted">employee_id</dt>
        <dd className="font-mono text-text">{a.employee_id ?? "—"}</dd>
        <dt className="text-text-muted">任务模板</dt>
        <dd className="text-text whitespace-pre-wrap">{a.task_template ?? "—"}</dd>
      </dl>
    );
  }
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs">
      <dt className="text-text-muted">类型</dt>
      <dd className="font-mono text-text">continue_conversation</dd>
      <dt className="text-text-muted">conversation_id</dt>
      <dd className="font-mono text-text">{a.conversation_id ?? "—"}</dd>
      <dt className="text-text-muted">消息模板</dt>
      <dd className="text-text whitespace-pre-wrap">{a.message_template ?? "—"}</dd>
    </dl>
  );
}

function FireRow({ f }: { f: Fire }) {
  const statusClass =
    f.status === "dispatched" || f.status === "succeeded"
      ? "text-success"
      : f.status === "rate_limited" || f.status === "paused" || f.status === "cycle_blocked"
        ? "text-warning"
        : f.status === "failed"
          ? "text-danger"
          : "text-text-muted";
  return (
    <div
      data-testid={`fire-${f.id}`}
      className="rounded-md border border-border bg-bg px-3 py-2 flex items-center gap-3 text-xs"
    >
      <span className={`font-mono ${statusClass} shrink-0`}>{f.status}</span>
      <span className="text-text-muted shrink-0">{formatTime(f.fired_at)}</span>
      <span className="text-text-subtle text-[10px] shrink-0">{f.source}</span>
      {f.run_id && (
        <Link
          href={`/traces?run_id=${encodeURIComponent(f.run_id)}`}
          className="font-mono text-text-muted hover:text-text transition-colors duration-base truncate"
        >
          {f.run_id}
        </Link>
      )}
      {f.error_code && (
        <span className="font-mono text-danger truncate" title={f.error_detail ?? ""}>
          {f.error_code}
        </span>
      )}
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
