"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { TaskStatusPill } from "@/components/tasks/TaskStatusPill";
import { RunTracePanel } from "@/components/runs/RunTracePanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { isImeComposing } from "@/lib/ime";
import {
  answerTask,
  approveTask,
  cancelTask,
  getTask,
  PENDING_USER_STATUSES,
  sourceLabel,
  statusLabel,
  TERMINAL_STATUSES,
  type TaskDto,
} from "@/lib/tasks-api";

type LoadStatus = "loading" | "ready" | "notfound" | "error";

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [task, setTask] = useState<TaskDto | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"answer" | "approve" | "deny" | "cancel" | "">("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [answer, setAnswer] = useState("");
  const [approveNote, setApproveNote] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await getTask(id);
      setTask(t);
      setLoadStatus("ready");
    } catch (err) {
      const msg = String(err);
      if (msg.includes("404")) setLoadStatus("notfound");
      else {
        setError(msg);
        setLoadStatus("error");
      }
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void load();
  }, [id, load]);

  // Poll while task is non-terminal — cheap way to keep the detail page fresh
  // until we wire SSE in slice 2.
  useEffect(() => {
    if (!task) return;
    if (TERMINAL_STATUSES.has(task.status)) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void load(), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [task, load]);

  if (!id || loadStatus === "loading") {
    return (
      <AppShell title="任务">
        <div className="h-full overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 py-8">
            <LoadingState title="加载任务" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (loadStatus === "notfound") {
    return (
      <AppShell title="任务">
        <div className="h-full overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 py-8">
            <div
              data-testid="task-notfound"
              className="rounded-xl border border-dashed border-border p-10 text-center"
            >
              <p className="text-sm text-text mb-2">找不到任务 {id}</p>
              <p className="text-xs text-text-subtle mb-4">
                可能已经被取消或删除。
              </p>
              <Link
                href="/tasks"
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors duration-base"
              >
                回到收件箱
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (loadStatus === "error" || !task) {
    return (
      <AppShell title="任务">
        <div className="h-full overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 py-8">
            <div
              data-testid="task-error"
              className="rounded-xl border border-danger/30 bg-danger/5 p-6"
            >
              <p className="text-sm text-danger mb-2">加载任务失败</p>
              <p className="text-xs text-text-muted mb-3 font-mono">{error}</p>
              <button
                onClick={() => void load()}
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors duration-base"
              >
                重试
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const canCancel = !TERMINAL_STATUSES.has(task.status);
  const needsUser = PENDING_USER_STATUSES.has(task.status);

  async function doAnswer() {
    if (!task || !answer.trim()) return;
    setBusy("answer");
    try {
      const next = await answerTask(task.id, answer.trim());
      setTask(next);
      setAnswer("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy("");
    }
  }

  async function doApprove(decision: "approved" | "denied") {
    if (!task) return;
    setBusy(decision === "approved" ? "approve" : "deny");
    try {
      const next = await approveTask(task.id, decision, approveNote.trim() || undefined);
      setTask(next);
      setApproveNote("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy("");
    }
  }

  async function doCancel() {
    if (!task) return;
    setBusy("cancel");
    try {
      const next = await cancelTask(task.id);
      setTask(next);
      setConfirmCancel(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell
      title={`任务 · ${task.title}`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/tasks"
            className="text-xs text-text-muted hover:text-text transition-colors duration-base"
          >
            ← 收件箱
          </Link>
          {canCancel && (
            <button
              onClick={() => setConfirmCancel(true)}
              data-testid="task-cancel"
              className="text-xs px-3 py-1.5 rounded-md border border-border text-danger hover:bg-danger/10 transition-colors duration-base"
            >
              取消任务
            </button>
          )}
        </div>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-6 flex flex-col gap-6">
          <TaskHeader task={task} />

          {needsUser && task.status === "needs_input" && (
            <NeedsInputPanel
              question={task.pending_input_question ?? "(无)"}
              answer={answer}
              onChange={setAnswer}
              busy={busy === "answer"}
              onSubmit={() => void doAnswer()}
            />
          )}

          {needsUser && task.status === "needs_approval" && (
            <NeedsApprovalPanel
              payload={task.pending_approval_payload}
              note={approveNote}
              onNoteChange={setApproveNote}
              onApprove={() => void doApprove("approved")}
              onDeny={() => void doApprove("denied")}
              busy={busy === "approve" || busy === "deny"}
            />
          )}

          {task.status === "completed" && task.result_summary && (
            <Callout tone="success" title="完成摘要">
              <MarkdownLike text={task.result_summary} />
            </Callout>
          )}

          {(task.status === "failed" || task.status === "cancelled") &&
            task.error_summary && (
              <Callout tone="danger" title={task.status === "failed" ? "失败原因" : "取消原因"}>
                <MarkdownLike text={task.error_summary} />
              </Callout>
            )}

          <Section title="Definition of Done">
            <MarkdownLike text={task.dod} />
          </Section>

          <Section title="目标">
            <MarkdownLike text={task.goal} />
          </Section>

          <Section title="运行">
            {task.run_ids.length === 0 ? (
              <p className="text-xs text-text-subtle">
                尚未分配 run · 一旦 TaskExecutor 起来就会出现。
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {task.run_ids.map((r) => (
                  <RunTracePanel key={r} runId={r} />
                ))}
              </div>
            )}
          </Section>

          <Section title="产出制品">
            {task.artifact_ids.length === 0 ? (
              <p className="text-xs text-text-subtle">还没有产出。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {task.artifact_ids.map((a) => (
                  <li key={a}>
                    <Link
                      href={`/artifacts/${a}`}
                      className="font-mono text-[11px] text-primary hover:underline"
                    >
                      {a}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="元数据">
            <MetaGrid task={task} />
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title={`取消任务 ${task.title}?`}
        message="取消会停止正在跑的 run。已产出的制品会保留,但任务不会继续。"
        confirmLabel="取消任务"
        danger
        busy={busy === "cancel"}
        onConfirm={() => void doCancel()}
        onCancel={() => setConfirmCancel(false)}
      />
    </AppShell>
  );
}

function TaskHeader({ task }: { task: TaskDto }) {
  const created = new Date(task.created_at).toLocaleString();
  const completed = task.completed_at ? new Date(task.completed_at).toLocaleString() : null;
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <TaskStatusPill status={task.status} />
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
              {sourceLabel(task.source)}
            </span>
            <span className="font-mono text-[10px] text-text-subtle">
              {task.id}
            </span>
          </div>
          <h2 className="text-base font-semibold text-text leading-tight">
            {task.title}
          </h2>
          <p className="mt-1 text-[11px] text-text-subtle">
            发起于 {created}
            {completed ? ` · ${statusLabel(task.status)} 于 ${completed}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-text-subtle">指派给</p>
          <p className="font-mono text-xs text-text">{task.assignee_id}</p>
        </div>
      </div>
    </div>
  );
}

function NeedsInputPanel({
  question,
  answer,
  onChange,
  busy,
  onSubmit,
}: {
  question: string;
  answer: string;
  onChange: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const isComposingRef = useRef(false);

  return (
    <div
      data-testid="needs-input-panel"
      className="rounded-xl border border-warning/40 bg-warning/5 p-5"
    >
      <p className="text-[10px] font-mono uppercase tracking-wider text-warning mb-2">
        等你回答
      </p>
      <p className="text-sm text-text mb-3">{question}</p>
      <textarea
        data-testid="answer-input"
        value={answer}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
        }}
        rows={3}
        placeholder="一两句话回给员工 · Enter 发送 / Shift+Enter 换行"
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !isImeComposing(e, isComposingRef.current) &&
            !e.shiftKey &&
            !busy &&
            answer.trim()
          ) {
            e.preventDefault();
            onSubmit();
          }
        }}
        className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-warning transition-colors duration-base resize-y"
      />
      <div className="flex justify-end mt-2">
        <button
          data-testid="answer-submit"
          onClick={onSubmit}
          disabled={busy || !answer.trim()}
          className="rounded-md bg-warning text-white hover:opacity-90 disabled:opacity-40 px-4 py-1.5 text-xs font-medium transition-opacity duration-base"
        >
          {busy ? "发送中…" : "发送答复"}
        </button>
      </div>
    </div>
  );
}

function NeedsApprovalPanel({
  payload,
  note,
  onNoteChange,
  onApprove,
  onDeny,
  busy,
}: {
  payload: Record<string, unknown> | null;
  note: string;
  onNoteChange: (v: string) => void;
  onApprove: () => void;
  onDeny: () => void;
  busy: boolean;
}) {
  const summary =
    payload && typeof payload.summary === "string"
      ? (payload.summary as string)
      : "员工请求你对一次操作放行。";
  const toolId =
    payload && typeof payload.tool_id === "string" ? (payload.tool_id as string) : null;
  return (
    <div
      data-testid="needs-approval-panel"
      className="rounded-xl border border-warning/40 bg-warning/5 p-5"
    >
      <p className="text-[10px] font-mono uppercase tracking-wider text-warning mb-2">
        等你审批
      </p>
      <p className="text-sm text-text mb-2">{summary}</p>
      {toolId && (
        <p className="text-[11px] font-mono text-text-muted mb-3">tool: {toolId}</p>
      )}
      {payload && Object.keys(payload).length > 0 && (
        <pre
          data-testid="approval-payload"
          className="text-[11px] font-mono text-text-muted bg-bg border border-border rounded-md p-3 mb-3 overflow-x-auto"
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
      <input
        data-testid="approve-note"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="可选 · 给员工留一句话"
        className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-warning transition-colors duration-base mb-3"
      />
      <div className="flex justify-end gap-2">
        <button
          data-testid="deny-button"
          onClick={onDeny}
          disabled={busy}
          className="rounded-md border border-border text-text-muted hover:text-danger hover:border-danger/40 disabled:opacity-40 px-4 py-1.5 text-xs transition-colors duration-base"
        >
          拒绝
        </button>
        <button
          data-testid="approve-button"
          onClick={onApprove}
          disabled={busy}
          className="rounded-md bg-success text-white hover:opacity-90 disabled:opacity-40 px-4 py-1.5 text-xs font-medium transition-opacity duration-base"
        >
          {busy ? "…" : "批准"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-text-subtle mb-3">
        {title}
      </h3>
      <div className="text-sm text-text">{children}</div>
    </section>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "success" | "danger";
  title: string;
  children: React.ReactNode;
}) {
  const border = tone === "success" ? "border-success/40" : "border-danger/40";
  const bg = tone === "success" ? "bg-success/5" : "bg-danger/5";
  const label = tone === "success" ? "text-success" : "text-danger";
  return (
    <div className={`rounded-xl border ${border} ${bg} p-5`}>
      <p className={`text-[10px] font-mono uppercase tracking-wider ${label} mb-2`}>
        {title}
      </p>
      <div className="text-sm text-text">{children}</div>
    </div>
  );
}

function MarkdownLike({ text }: { text: string }) {
  // Light preserve-whitespace rendering; full markdown rendering is out of scope.
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm text-text leading-relaxed">
      {text}
    </pre>
  );
}

function MetaGrid({ task }: { task: TaskDto }) {
  const rows: { k: string; v: string }[] = [
    { k: "workspace", v: task.workspace_id },
    { k: "created_by", v: task.created_by },
    { k: "source", v: task.source },
    { k: "parent_task", v: task.parent_task_id ?? "—" },
    { k: "conversation", v: task.conversation_id ?? "—" },
    { k: "token_budget", v: task.token_budget == null ? "无限制" : String(task.token_budget) },
    { k: "tokens_used", v: String(task.tokens_used) },
    { k: "updated_at", v: new Date(task.updated_at).toLocaleString() },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
      {rows.map((r) => (
        <div key={r.k} className="flex justify-between gap-2 border-b border-border pb-1">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            {r.k}
          </dt>
          <dd className="font-mono text-[11px] text-text truncate">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}
