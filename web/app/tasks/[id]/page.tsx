"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState, ErrorState } from "@/components/state";
import { TaskStatusPill } from "@/components/tasks/TaskStatusPill";
import { RunTracePanel } from "@/components/runs/RunTracePanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { isImeComposing } from "@/lib/ime";
import {
  answerTask,
  approveTask,
  cancelTask,
  getTask,
  PENDING_USER_STATUSES,
  TERMINAL_STATUSES,
  type TaskDto,
  type TaskStatus,
} from "@/lib/tasks-api";

type LoadStatus = "loading" | "ready" | "notfound" | "error";

/**
 * Task detail page · Brand Blue Dual Theme V2 (ADR 0016).
 *
 * Layout:
 *   Hero card (status-tinted icon tile + title/pill/id + assignee/dates)
 *   → KPI strip (4 mini-stats: duration · tokens · runs · cost-placeholder)
 *   → Pending-user banner (if needs_input / needs_approval)
 *   → Outcome callouts (success summary / failure reason)
 *   → Definition of Done / Goal (mono-text panels)
 *   → Linked conversation chip (if any)
 *   → Runs (RunTracePanel each)
 *   → Artifacts / Metadata
 *
 * All data-fetch / polling / mutation / navigation semantics preserved.
 */
export default function TaskDetailPage() {
  const t = useTranslations("tasks.detail");
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
      <AppShell title={t("shellTitle")}>
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-5xl px-8 py-8 animate-fade-up">
            <LoadingState title={t("loading")} />
          </div>
        </div>
      </AppShell>
    );
  }

  if (loadStatus === "notfound") {
    return (
      <AppShell title={t("shellTitle")}>
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 py-10 animate-fade-up">
            <div
              data-testid="task-notfound"
              className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-surface p-12 text-center shadow-soft-sm"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-50"
                style={{
                  background:
                    "radial-gradient(400px 200px at 50% 0%, var(--color-primary-muted), transparent 70%)",
                }}
              />
              <div className="relative">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-text-muted shadow-soft-sm">
                  <Icon name="alert-circle" size={24} />
                </div>
                <p className="mt-5 text-base font-semibold text-text">{t("notFound")}</p>
                <p className="mt-1 font-mono text-[11px] text-text-subtle">{id}</p>
                <p className="mt-2 text-sm text-text-muted">{t("notFoundHint")}</p>
                <Link
                  href="/tasks"
                  className="mt-6 inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-text shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft"
                >
                  <Icon name="arrow-left" size={13} />
                  {t("backToInbox")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (loadStatus === "error" || !task) {
    return (
      <AppShell title={t("shellTitle")}>
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 py-8 animate-fade-up" data-testid="task-error">
            <ErrorState
              title={t("loadFailed")}
              detail={error}
              action={{ label: t("retry"), onClick: () => void load() }}
            />
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
      title={t("shellTitleWithName", { title: task.title })}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/tasks"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-text-muted transition-colors duration-base hover:text-text hover:bg-surface-2"
          >
            <Icon name="arrow-left" size={12} />
            {t("inbox")}
          </Link>
          {canCancel && (
            <button
              onClick={() => setConfirmCancel(true)}
              data-testid="task-cancel"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger/30 bg-surface px-3 text-[12px] font-medium text-danger shadow-soft-sm transition-colors duration-base hover:bg-danger/10 hover:border-danger/50"
            >
              <Icon name="x" size={12} />
              {t("cancelTask")}
            </button>
          )}
        </div>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-6 animate-fade-up">
          <TaskHero task={task} />
          <TaskKpiStrip task={task} />

          {needsUser && task.status === "needs_input" && (
            <NeedsInputPanel
              question={task.pending_input_question ?? t("noQuestion")}
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
            <Callout tone="success" title={t("completedSummary")} icon="check-circle-2">
              <MarkdownLike text={task.result_summary} />
            </Callout>
          )}

          {(task.status === "failed" || task.status === "cancelled") &&
            task.error_summary && (
              <Callout
                tone="danger"
                title={task.status === "failed" ? t("failedReason") : t("cancelledReason")}
                icon="alert-circle"
              >
                <MarkdownLike text={task.error_summary} />
              </Callout>
            )}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Section title={t("goal")} icon="sparkles">
              <MarkdownLike text={task.goal} />
            </Section>
            <Section title={t("dod")} icon="shield-check">
              <MarkdownLike text={task.dod} />
            </Section>
          </div>

          {task.conversation_id && (
            <LinkedConversation conversationId={task.conversation_id} />
          )}

          <Section title={t("runs")} icon="activity" count={task.run_ids.length}>
            {task.run_ids.length === 0 ? (
              <EmptyHint
                icon="clock"
                text={t("runsEmpty")}
              />
            ) : (
              <div className="flex flex-col gap-4">
                {task.run_ids.map((r) => (
                  <RunTracePanel key={r} runId={r} />
                ))}
              </div>
            )}
          </Section>

          <Section title={t("artifacts")} icon="file" count={task.artifact_ids.length}>
            {task.artifact_ids.length === 0 ? (
              <EmptyHint icon="file" text={t("artifactsEmpty")} />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {task.artifact_ids.map((a) => (
                  <li key={a}>
                    <Link
                      href={`/artifacts/${a}`}
                      className="group inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-primary transition-colors duration-base hover:border-primary/40 hover:bg-primary-muted"
                    >
                      <Icon name="file" size={11} className="text-text-subtle group-hover:text-primary" />
                      {a}
                      <Icon name="external-link" size={10} className="opacity-0 transition-opacity duration-fast group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t("metadata")} icon="database">
            <MetaGrid task={task} />
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title={t("cancelTaskTitle", { title: task.title })}
        message={t("cancelTaskMessage")}
        confirmLabel={t("cancelTaskConfirm")}
        danger
        busy={busy === "cancel"}
        onConfirm={() => void doCancel()}
        onCancel={() => setConfirmCancel(false)}
      />
    </AppShell>
  );
}

/* ------------------------------- subcomponents ---------------------------- */

type HeroTone = "warning" | "primary" | "success" | "danger" | "neutral";

function heroToneFor(status: TaskStatus): { tone: HeroTone; icon: IconName; spin: boolean } {
  if (status === "needs_input" || status === "needs_approval")
    return { tone: "warning", icon: "alert-triangle", spin: false };
  if (status === "running") return { tone: "primary", icon: "loader", spin: true };
  if (status === "completed") return { tone: "success", icon: "check-circle-2", spin: false };
  if (status === "failed") return { tone: "danger", icon: "alert-circle", spin: false };
  if (status === "cancelled") return { tone: "danger", icon: "x", spin: false };
  return { tone: "neutral", icon: "clock", spin: false };
}

const TONE_TILE: Record<HeroTone, string> = {
  warning: "bg-warning-soft text-warning",
  primary: "bg-primary-muted text-primary",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-2 text-text-muted",
};

const TONE_ACCENT: Record<HeroTone, string> = {
  warning: "from-transparent via-warning to-transparent",
  primary: "from-transparent via-primary to-transparent",
  success: "from-transparent via-success to-transparent",
  danger: "from-transparent via-danger to-transparent",
  neutral: "from-transparent via-border-strong to-transparent",
};

function TaskHero({ task }: { task: TaskDto }) {
  const t = useTranslations("tasks.detail");
  const statusT = useTranslations("tasks.status");
  const sourceT = useTranslations("tasks.source");
  const created = new Date(task.created_at).toLocaleString();
  const updated = new Date(task.updated_at).toLocaleString();
  const completed = task.completed_at ? new Date(task.completed_at).toLocaleString() : null;
  const { tone, icon, spin } = heroToneFor(task.status);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-soft-sm">
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${TONE_ACCENT[tone]}`}
      />
      <div className="flex items-start gap-4">
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${TONE_TILE[tone]}`}
        >
          <Icon name={icon} size={22} className={spin ? "animate-spin" : undefined} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusPill status={task.status} />
            <span className="inline-flex h-5 items-center rounded bg-surface-2 px-1.5 font-mono text-[10px] text-text-muted">
              {sourceT(task.source)}
            </span>
            <span className="font-mono text-[10px] text-text-subtle">{task.id}</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-tight tracking-tight text-text">
            {task.title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-subtle">
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" size={11} />
              {t("createdAt", { at: created })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon name="refresh" size={11} />
              {t("updatedAt", { at: updated })}
            </span>
            {completed && (
              <span className="inline-flex items-center gap-1">
                <Icon name="check" size={11} />
                {t("completedAt", { status: statusT(task.status), at: completed })}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-subtle">
            {t("assignedTo")}
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1">
            <span
              aria-hidden
              className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold text-primary-fg"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
              }}
            >
              {task.assignee_id.slice(0, 1).toUpperCase()}
            </span>
            <span className="font-mono text-[11px] text-text">{task.assignee_id}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskKpiStrip({ task }: { task: TaskDto }) {
  const t = useTranslations("tasks.detail");
  const duration = useMemo(() => {
    const start = new Date(task.created_at).getTime();
    const end = task.completed_at
      ? new Date(task.completed_at).getTime()
      : new Date(task.updated_at).getTime();
    const ms = Math.max(0, end - start);
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }, [task.created_at, task.updated_at, task.completed_at]);

  const tokensHint =
    task.token_budget == null
      ? t("kpiTokenNoBudget")
      : t("kpiTokenBudget", { budget: task.token_budget.toLocaleString() });

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiCard
        label={t("kpiDuration")}
        value={duration}
        hint={task.completed_at ? t("kpiDurationDone") : t("kpiDurationRunning")}
        icon="clock"
        tone="primary"
      />
      <KpiCard
        label={t("kpiToken")}
        value={task.tokens_used.toLocaleString()}
        hint={tokensHint}
        icon="zap"
        tone="warning"
      />
      <KpiCard
        label={t("kpiRuns")}
        value={String(task.run_ids.length)}
        hint={task.run_ids.length === 0 ? t("kpiRunsUnassigned") : t("kpiRunsDispatched")}
        icon="activity"
        tone="success"
      />
      <KpiCard
        label={t("kpiArtifacts")}
        value={String(task.artifact_ids.length)}
        hint={task.artifact_ids.length === 0 ? t("kpiArtifactsNone") : t("kpiArtifactsAvailable")}
        icon="file"
        tone="neutral"
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: IconName;
  tone: "primary" | "warning" | "success" | "neutral";
}) {
  const toneClass: Record<typeof tone, string> = {
    primary: "bg-primary-muted text-primary",
    warning: "bg-warning-soft text-warning",
    success: "bg-success-soft text-success",
    neutral: "bg-surface-2 text-text-muted",
  };
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:border-border-strong hover:shadow-soft">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
            {label}
          </div>
          <div className="mt-1.5 truncate text-xl font-bold tabular-nums text-text">
            {value}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-text-subtle">
            {hint}
          </div>
        </div>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${toneClass[tone]}`}>
          <Icon name={icon} size={15} />
        </div>
      </div>
    </div>
  );
}

function LinkedConversation({ conversationId }: { conversationId: string }) {
  const t = useTranslations("tasks.detail");
  return (
    <Link
      href={`/chat/${conversationId}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-soft-sm transition duration-base hover:-translate-y-px hover:border-primary/40 hover:shadow-soft"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-muted text-primary">
        <Icon name="message-square" size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-subtle">
          {t("linkedConversation")}
        </div>
        <div className="mt-0.5 truncate font-mono text-[12px] text-text transition-colors duration-base group-hover:text-primary">
          {conversationId}
        </div>
      </div>
      <Icon
        name="arrow-right"
        size={14}
        className="shrink-0 text-text-subtle transition-[transform,color] duration-fast group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </Link>
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
  const t = useTranslations("tasks.detail");
  const isComposingRef = useRef(false);

  return (
    <div
      data-testid="needs-input-panel"
      className="relative overflow-hidden rounded-2xl border border-warning/40 bg-warning-soft p-5 shadow-soft-sm"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-warning to-transparent"
      />
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning">
          <Icon name="message-square" size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-warning">
            {t("needsAnswer")}
          </p>
          <p className="mt-1.5 text-sm text-text">{question}</p>
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
            placeholder={t("answerPlaceholder")}
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
            className="mt-3 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder-text-subtle transition-colors duration-base focus:border-warning focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-text-subtle">
              <KbdChip>Enter</KbdChip>
              <span>{t("kbdSend")}</span>
              <span className="mx-1 opacity-40">·</span>
              <KbdChip>Shift</KbdChip>
              <span>+</span>
              <KbdChip>Enter</KbdChip>
              <span>{t("kbdNewline")}</span>
            </span>
            <button
              data-testid="answer-submit"
              onClick={onSubmit}
              disabled={busy || !answer.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-warning px-4 text-[12px] font-medium text-white shadow-soft-sm transition-opacity duration-base hover:-translate-y-px hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            >
              {busy ? (
                <Icon name="loader" size={12} className="animate-spin" />
              ) : (
                <Icon name="send" size={12} />
              )}
              {busy ? t("sending") : t("sendAnswer")}
            </button>
          </div>
        </div>
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
  const t = useTranslations("tasks.detail");
  const summary =
    payload && typeof payload.summary === "string"
      ? (payload.summary as string)
      : t("approvalDefaultSummary");
  const toolId =
    payload && typeof payload.tool_id === "string" ? (payload.tool_id as string) : null;
  return (
    <div
      data-testid="needs-approval-panel"
      className="relative overflow-hidden rounded-2xl border border-warning/40 bg-warning-soft p-5 shadow-soft-sm"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-warning to-transparent"
      />
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning">
          <Icon name="shield-check" size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-warning">
            {t("needsApproval")}
          </p>
          <p className="mt-1.5 text-sm text-text">{summary}</p>
          {toolId && (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-text-muted">
              <Icon name="terminal" size={10} />
              {t("approvalToolPrefix", { id: toolId })}
            </p>
          )}
          {payload && Object.keys(payload).length > 0 && (
            <pre
              data-testid="approval-payload"
              className="mt-3 overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-[11px] text-text-muted"
            >
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
          <input
            data-testid="approve-note"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={t("approvalNotePlaceholder")}
            className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder-text-subtle transition-colors duration-base focus:border-warning focus:outline-none"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              data-testid="deny-button"
              onClick={onDeny}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[12px] text-text-muted transition-colors duration-base hover:border-danger/40 hover:text-danger disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon name="x" size={12} />
              {t("deny")}
            </button>
            <button
              data-testid="approve-button"
              onClick={onApprove}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-success px-4 text-[12px] font-medium text-white shadow-soft-sm transition-opacity duration-base hover:-translate-y-px hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            >
              {busy ? (
                <Icon name="loader" size={12} className="animate-spin" />
              ) : (
                <Icon name="check" size={12} />
              )}
              {busy ? t("approveBusy") : t("approve")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon?: IconName;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-soft-sm">
      <header className="mb-3 flex items-center gap-2">
        {icon && (
          <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-2 text-text-muted">
            <Icon name={icon} size={12} />
          </span>
        )}
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-text-subtle">
          {title}
        </h3>
        {typeof count === "number" && count > 0 && (
          <span className="inline-flex h-4 items-center rounded bg-primary-muted px-1.5 font-mono text-[10px] text-primary">
            {count}
          </span>
        )}
      </header>
      <div className="text-sm text-text">{children}</div>
    </section>
  );
}

function Callout({
  tone,
  title,
  icon,
  children,
}: {
  tone: "success" | "danger";
  title: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  const classes =
    tone === "success"
      ? {
          border: "border-success/30",
          bg: "bg-success-soft",
          label: "text-success",
          tile: "bg-success/15 text-success",
          accent: "from-transparent via-success to-transparent",
        }
      : {
          border: "border-danger/30",
          bg: "bg-danger-soft",
          label: "text-danger",
          tile: "bg-danger/15 text-danger",
          accent: "from-transparent via-danger to-transparent",
        };
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${classes.border} ${classes.bg} p-5 shadow-soft-sm`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${classes.accent}`}
      />
      <div className="flex items-start gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${classes.tile}`}>
          <Icon name={icon} size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-mono uppercase tracking-wider ${classes.label}`}>
            {title}
          </p>
          <div className="mt-1.5 text-sm text-text">{children}</div>
        </div>
      </div>
    </div>
  );
}

function MarkdownLike({ text }: { text: string }) {
  // Light preserve-whitespace rendering; full markdown rendering is out of scope.
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-text">
      {text}
    </pre>
  );
}

function EmptyHint({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface-2/50 px-3 py-2.5 text-[11px] text-text-subtle">
      <Icon name={icon} size={12} />
      <span>{text}</span>
    </div>
  );
}

function KbdChip({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded border border-border bg-surface px-1 font-mono text-[9px] text-text-muted shadow-soft-sm">
      {children}
    </kbd>
  );
}

function MetaGrid({ task }: { task: TaskDto }) {
  const t = useTranslations("tasks.detail");
  const rows: { k: string; v: string; icon: IconName }[] = [
    { k: "workspace", v: task.workspace_id, icon: "layout-grid" },
    { k: "created_by", v: task.created_by, icon: "user" },
    { k: "source", v: task.source, icon: "zap" },
    { k: "parent_task", v: task.parent_task_id ?? "—", icon: "link" },
    { k: "conversation", v: task.conversation_id ?? "—", icon: "message-square" },
    {
      k: "token_budget",
      v: task.token_budget == null ? t("noLimit") : String(task.token_budget),
      icon: "sparkles",
    },
    { k: "tokens_used", v: String(task.tokens_used), icon: "activity" },
    { k: "updated_at", v: new Date(task.updated_at).toLocaleString(), icon: "clock" },
  ];
  return (
    <dl className="grid grid-cols-1 gap-1.5 md:grid-cols-2 md:gap-x-6 md:gap-y-1.5">
      {rows.map((r) => (
        <div
          key={r.k}
          className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0"
        >
          <dt className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            <Icon name={r.icon} size={10} />
            {r.k}
          </dt>
          <dd className="min-w-0 truncate font-mono text-[11px] text-text" title={r.v}>
            {r.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
