"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, LoadingState } from "@/components/state";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TraceChip } from "@/components/runs/TraceChip";
import { Icon, type IconName } from "@/components/ui/icon";

/**
 * Trigger detail page · ADR 0016 V2 Azure Live polish.
 *
 * Breadcrumb · gradient hero (timer/event tile · enable dot · kind chip · run
 * counts) · warning strip for auto-disabled state · sectioned body for
 * condition / action / recent fires. Actions: 手动触发 · 启用/停用 · 删除.
 * All fetch / mutation / navigation / data-testid preserved.
 */

type Kind = "timer" | "event";
type ActionType =
  | "notify_user"
  | "invoke_tool"
  | "dispatch_employee"
  | "continue_conversation";

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
  const t = useTranslations("triggers.detail");
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [fires, setFires] = useState<Fire[]>([]);
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "notfound"
  >("loading");
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
        const detail = (await res.json().catch(() => ({}))) as {
          detail?: string;
        };
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
    <AppShell title={trigger?.name ?? t("fallbackTitle")}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          <Breadcrumb name={trigger?.name} />

          {status === "loading" && (
            <div data-testid="detail-loading">
              <LoadingState title={t("loading")} />
            </div>
          )}

          {status === "notfound" && (
            <div
              data-testid="detail-notfound"
              className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-surface p-10 text-center"
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-surface-2 text-text-muted mx-auto mb-3">
                <Icon name="alert-circle" size={22} />
              </span>
              <p className="text-sm font-semibold text-text mb-1">
                {t("notFound")}
              </p>
              <p className="font-mono text-caption text-text-subtle">{id}</p>
            </div>
          )}

          {status === "error" && (
            <div
              data-testid="detail-error"
              className="rounded-xl border border-danger/30 bg-danger-soft p-5"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-danger/15 text-danger shrink-0">
                  <Icon name="alert-circle" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-danger mb-1">
                    {t("loadFailed")}
                  </p>
                  <p className="text-xs font-mono text-text-muted break-all mb-3">
                    {error}
                  </p>
                  <button
                    onClick={() => void load()}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
                  >
                    <Icon name="refresh" size={12} />
                    {t("retry")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {status === "ready" && trigger && (
            <>
              <Hero
                t={trigger}
                busy={busy}
                onToggle={() => void handleToggle()}
                onFire={() => setConfirmFire(true)}
                onDelete={() => setConfirmDelete(true)}
              />

              {trigger.auto_disabled_reason && (
                <div className="rounded-xl border border-warning/40 bg-warning-soft p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-warning/15 text-warning shrink-0">
                      <Icon name="alert-triangle" size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-warning mb-1">
                        {t("autoDisabledTitle")}
                      </p>
                      <p className="text-[12px] text-text-muted leading-relaxed">
                        {trigger.auto_disabled_reason}
                      </p>
                      <p className="font-mono text-caption text-text-subtle mt-1">
                        {t("autoDisabledHint")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <Section title={t("sectionCondition")} icon="clock">
                {trigger.kind === "timer" ? (
                  <MetaGrid
                    items={[
                      { k: t("metaCron"), v: trigger.timer?.cron ?? "—", mono: true },
                      {
                        k: t("metaTimezone"),
                        v: trigger.timer?.timezone ?? "—",
                        mono: true,
                      },
                      {
                        k: t("metaMinInterval"),
                        v: `${trigger.min_interval_seconds} s`,
                        mono: true,
                      },
                    ]}
                  />
                ) : (
                  <MetaGrid
                    items={[
                      {
                        k: t("metaEventKind"),
                        v: trigger.event?.type ?? "—",
                        mono: true,
                      },
                      {
                        k: t("metaFilter"),
                        v: JSON.stringify(trigger.event?.filter ?? {}),
                        mono: true,
                      },
                      {
                        k: t("metaMinInterval"),
                        v: `${trigger.min_interval_seconds} s`,
                        mono: true,
                      },
                    ]}
                  />
                )}
              </Section>

              <Section title={t("sectionAction")} icon="play-circle">
                <ActionPreview t={trigger} />
              </Section>

              <Section
                title={t("sectionFires", { count: fires.length })}
                icon="activity"
              >
                {fires.length === 0 ? (
                  <div data-testid="fires-empty">
                    <EmptyState
                      title={t("firesEmptyTitle")}
                      description={t("firesEmptyDescription")}
                    />
                  </div>
                ) : (
                  <div
                    data-testid="fires-list"
                    className="flex flex-col gap-2"
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
        title={t("fireConfirmTitle", { name: trigger?.name ?? "" })}
        message={t("fireConfirmMessage")}
        confirmLabel={t("fireConfirmLabel")}
        busy={busy === "fire"}
        onConfirm={() => void handleFireNow()}
        onCancel={() => setConfirmFire(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={t("deleteConfirmTitle", { name: trigger?.name ?? "" })}
        message={t("deleteConfirmMessage")}
        confirmLabel={t("deleteConfirmLabel")}
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </AppShell>
  );
}

function Breadcrumb({ name }: { name?: string }) {
  const t = useTranslations("triggers.detail");
  return (
    <div className="flex items-center gap-1.5 font-mono text-caption uppercase tracking-wider text-text-subtle">
      <Link
        href="/triggers"
        className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-text-muted hover:text-primary hover:bg-primary-muted transition duration-base"
      >
        <Icon name="arrow-left" size={11} strokeWidth={2} />
        {t("breadcrumb")}
      </Link>
      <Icon name="chevron-right" size={11} className="text-text-subtle" />
      <span className="text-text truncate max-w-[30ch]">{name ?? "…"}</span>
    </div>
  );
}

function Hero({
  t: trigger,
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
  const t = useTranslations("triggers.detail");
  const locale = useLocale();
  const kindIcon: IconName = trigger.kind === "timer" ? "clock" : "zap";
  const dotClass = trigger.auto_disabled_reason
    ? "bg-warning"
    : trigger.enabled
      ? "bg-success"
      : "bg-text-subtle";
  const stateChip = trigger.auto_disabled_reason
    ? "text-warning border-warning/30 bg-warning-soft"
    : trigger.enabled
      ? "text-success border-success/30 bg-success-soft"
      : "text-text-muted border-border bg-surface-2";
  const stateLabel = trigger.auto_disabled_reason
    ? t("stateAutoDisabled")
    : trigger.enabled
      ? t("stateEnabled")
      : t("stateDisabled");
  const stateIcon: IconName = trigger.auto_disabled_reason
    ? "alert-triangle"
    : trigger.enabled
      ? "check-circle-2"
      : "pause";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-sm p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, var(--color-primary) 50%, transparent 100%)",
          opacity: 0.25,
        }}
      />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <div
            className="grid h-14 w-14 place-items-center rounded-2xl text-primary-fg shadow-soft shrink-0"
            style={{
              background:
                "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
            }}
            aria-hidden="true"
          >
            <Icon name={kindIcon} size={26} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
                aria-hidden="true"
              />
              <h1 className="text-xl font-bold tracking-tight text-text truncate">
                {trigger.name}
              </h1>
              <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono">
                <Icon name={kindIcon} size={10} strokeWidth={2.25} />
                {trigger.kind}
              </span>
              <span
                className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-caption font-mono font-medium ${stateChip}`}
              >
                <Icon name={stateIcon} size={10} strokeWidth={2.25} />
                {stateLabel}
              </span>
              <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono">
                <Icon name="activity" size={10} strokeWidth={2.25} />
                {t("firesCount", { count: trigger.fires_total })}
              </span>
              {trigger.fires_failed_streak > 0 && (
                <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-danger/30 bg-danger-soft text-danger text-caption font-mono font-medium">
                  <Icon name="alert-circle" size={10} strokeWidth={2.25} />
                  {t("failedStreak", { count: trigger.fires_failed_streak })}
                </span>
              )}
            </div>
            <p className="text-[12px] text-text-muted leading-relaxed mb-1">
              {trigger.last_fired_at
                ? t("lastFired", { time: formatTime(trigger.last_fired_at, locale) })
                : t("neverFired")}
            </p>
            <p className="font-mono text-caption text-text-subtle truncate">
              {trigger.id}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <button
            onClick={onFire}
            disabled={busy !== ""}
            data-testid="fire-now"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-fg text-[12px] font-semibold shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-base"
          >
            {busy === "fire" ? (
              <>
                <Icon name="loader" size={12} className="animate-spin-slow" />
                {t("firing")}
              </>
            ) : (
              <>
                <Icon name="play" size={12} />
                {t("fireNow")}
              </>
            )}
          </button>
          <button
            onClick={onToggle}
            disabled={busy !== ""}
            data-testid="toggle"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm disabled:opacity-40 transition duration-base"
          >
            {busy === "toggle" ? (
              <>
                <Icon name="loader" size={12} className="animate-spin-slow" />
                …
              </>
            ) : trigger.enabled ? (
              <>
                <Icon name="pause" size={12} />
                {t("disable")}
              </>
            ) : (
              <>
                <Icon name="play" size={12} />
                {t("enable")}
              </>
            )}
          </button>
          <button
            onClick={onDelete}
            data-testid="delete"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-danger/30 bg-danger-soft text-[12px] font-semibold text-danger hover:bg-danger/15 transition duration-base"
          >
            <Icon name="trash-2" size={12} />
            {t("delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-border-strong), transparent)",
          opacity: 0.6,
        }}
      />
      <header className="flex items-center gap-2 mb-4">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-muted text-primary">
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
      </header>
      <div className="border-t border-border -mx-5 mb-4" />
      {children}
    </section>
  );
}

function MetaGrid({
  items,
}: {
  items: ReadonlyArray<{ k: string; v: React.ReactNode; mono?: boolean }>;
}) {
  return (
    <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
      {items.map((it, idx) => (
        <div key={idx} className="flex flex-col gap-1 min-w-0">
          <dt className="font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold">
            {it.k}
          </dt>
          <dd
            className={`text-sm text-text break-all ${
              it.mono ? "font-mono" : ""
            }`}
          >
            {it.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ActionPreview({ t: trigger }: { t: Trigger }) {
  const t = useTranslations("triggers.detail");
  const a = trigger.action;
  if (a.type === "notify_user") {
    return (
      <div className="space-y-4">
        <MetaGrid
          items={[
            { k: t("metaType"), v: "notify_user", mono: true },
            { k: t("metaChannel"), v: a.channel ?? "cockpit", mono: true },
          ]}
        />
        <div>
          <p className="font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold mb-2">
            {t("metaMessageTemplate")}
          </p>
          <pre className="text-[12px] font-mono text-text bg-surface-2 border border-border rounded-lg p-3 whitespace-pre-wrap break-words leading-relaxed">
            {a.message ?? "—"}
          </pre>
        </div>
      </div>
    );
  }
  if (a.type === "invoke_tool") {
    return (
      <div className="space-y-4">
        <MetaGrid
          items={[
            { k: t("metaType"), v: "invoke_tool", mono: true },
            { k: t("metaToolId"), v: a.tool_id ?? "—", mono: true },
          ]}
        />
        <div>
          <p className="font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold mb-2">
            {t("metaArgs")}
          </p>
          <pre className="text-[12px] font-mono text-text bg-surface-2 border border-border rounded-lg p-3 whitespace-pre-wrap break-words leading-relaxed">
            {JSON.stringify(a.args_template ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    );
  }
  if (a.type === "dispatch_employee") {
    return (
      <div className="space-y-4">
        <MetaGrid
          items={[
            { k: t("metaType"), v: "dispatch_employee", mono: true },
            { k: t("metaEmployeeId"), v: a.employee_id ?? "—", mono: true },
          ]}
        />
        <div>
          <p className="font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold mb-2">
            {t("metaTaskTemplate")}
          </p>
          <pre className="text-[12px] font-mono text-text bg-surface-2 border border-border rounded-lg p-3 whitespace-pre-wrap break-words leading-relaxed">
            {a.task_template ?? "—"}
          </pre>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <MetaGrid
        items={[
          { k: t("metaType"), v: "continue_conversation", mono: true },
          { k: t("metaConversationId"), v: a.conversation_id ?? "—", mono: true },
        ]}
      />
      <div>
        <p className="font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold mb-2">
          {t("metaMessageTemplate")}
        </p>
        <pre className="text-[12px] font-mono text-text bg-surface-2 border border-border rounded-lg p-3 whitespace-pre-wrap break-words leading-relaxed">
          {a.message_template ?? "—"}
        </pre>
      </div>
    </div>
  );
}

function FireRow({ f }: { f: Fire }) {
  const statusMeta = fireStatusMeta(f.status);
  const locale = useLocale();
  return (
    <div
      data-testid={`fire-${f.id}`}
      className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 flex items-center gap-3 flex-wrap hover:border-border-strong transition duration-base"
    >
      <span
        className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border font-mono text-caption font-medium shrink-0 ${statusMeta.chip}`}
      >
        <Icon name={statusMeta.icon} size={10} strokeWidth={2.25} />
        {f.status}
      </span>
      <span className="inline-flex items-center gap-1 font-mono text-caption text-text-muted shrink-0">
        <Icon name="clock" size={11} className="text-text-subtle" />
        {formatTime(f.fired_at, locale)}
      </span>
      <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-surface border border-border font-mono text-caption text-text-subtle shrink-0">
        {f.source}
      </span>
      {f.run_id && <TraceChip runId={f.run_id} label={f.run_id} />}
      {f.error_code && (
        <span
          className="inline-flex items-center gap-1 font-mono text-caption text-danger truncate"
          title={f.error_detail ?? ""}
        >
          <Icon name="alert-circle" size={11} />
          {f.error_code}
        </span>
      )}
    </div>
  );
}

function fireStatusMeta(status: string): { icon: IconName; chip: string } {
  if (status === "dispatched" || status === "succeeded") {
    return {
      icon: "check-circle-2",
      chip: "text-success border-success/30 bg-success-soft",
    };
  }
  if (
    status === "rate_limited" ||
    status === "paused" ||
    status === "cycle_blocked"
  ) {
    return {
      icon: "alert-triangle",
      chip: "text-warning border-warning/30 bg-warning-soft",
    };
  }
  if (status === "failed") {
    return {
      icon: "alert-circle",
      chip: "text-danger border-danger/30 bg-danger-soft",
    };
  }
  return {
    icon: "circle-help",
    chip: "text-text-muted border-border bg-surface",
  };
}

function formatTime(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(locale);
  } catch {
    return iso;
  }
}
