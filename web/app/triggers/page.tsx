"use client";

/**
 * Triggers · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Layout:
 *   · eyebrow + h1 hero + primary "new trigger" CTA
 *   · 4-card summary strip (total · active · fired today · next fire)
 *     with the first card gradient-primary to anchor the row
 *   · filter chips (All / Timer / Event / Disabled) — pill style
 *   · 2-col (xl) trigger cards with icon tile, inline toggle switch,
 *     mono schedule/event line, action chip, metadata row, footer actions
 *   · sectioned create modal with type-radio cards
 *   · dotgrid empty state with preset CTAs
 *   · bg-danger-soft error banner with retry
 *
 * Preserved behavior: list / toggle / delete / fire-now / create mutations,
 * ConfirmDialog wiring, testids, and AppShell + PageHeader composition.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";

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

type FilterKey = "all" | "timer" | "event" | "disabled";

const ACTION_ICON: Record<ActionType, IconName> = {
  notify_user: "bell",
  invoke_tool: "zap",
  dispatch_employee: "users",
  continue_conversation: "send",
};

const CRON_PRESETS: { cron: string; hint: "daily" | "weekly" | "frequent" }[] = [
  { cron: "0 8 * * *", hint: "daily" },
  { cron: "0 9 * * 1", hint: "weekly" },
  { cron: "*/15 * * * *", hint: "frequent" },
];

export default function TriggersPage() {
  const t = useTranslations("triggers.list");
  const tCommon = useTranslations("common");
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [initialDraft, setInitialDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<Trigger | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string>("");
  const [firingId, setFiringId] = useState<string>("");
  const [filter, setFilter] = useState<FilterKey>("all");

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

  const stats = useMemo(() => {
    const active = triggers.filter((t) => t.enabled && !t.auto_disabled_reason).length;
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).getTime();
    const firedToday = triggers.filter((t) => {
      if (!t.last_fired_at) return false;
      const when = new Date(t.last_fired_at).getTime();
      return Number.isFinite(when) && when >= startOfDay;
    }).length;
    const timers = triggers.filter(
      (t) => t.kind === "timer" && t.enabled && !t.auto_disabled_reason,
    ).length;
    return {
      total: triggers.length,
      active,
      firedToday,
      timers,
    };
  }, [triggers]);

  const filtered = useMemo(() => {
    return triggers.filter((t) => {
      if (filter === "all") return true;
      if (filter === "disabled") return !t.enabled || !!t.auto_disabled_reason;
      return t.kind === filter;
    });
  }, [triggers, filter]);

  const filterCounts = useMemo(() => {
    return {
      all: triggers.length,
      timer: triggers.filter((t) => t.kind === "timer").length,
      event: triggers.filter((t) => t.kind === "event").length,
      disabled: triggers.filter((t) => !t.enabled || !!t.auto_disabled_reason).length,
    } satisfies Record<FilterKey, number>;
  }, [triggers]);

  async function handleToggle(t: Trigger) {
    setBusyId(t.id);
    // Optimistic flip — we'll reload on success; on failure we surface the
    // error and the next load() reconciles whatever the server says.
    setTriggers((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, enabled: !x.enabled } : x)),
    );
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
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function handleFire(t: Trigger) {
    setFiringId(t.id);
    try {
      const res = await fetch(`/api/triggers/${t.id}/fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(detail.detail || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setFiringId("");
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

  function openCreate(preset?: Partial<CreateDraft>) {
    setInitialDraft({ ...EMPTY_DRAFT, ...(preset ?? {}) });
    setDrawerOpen(true);
  }

  return (
    <AppShell
      title={t("title")}
      actions={
        <button
          onClick={() => openCreate()}
          data-testid="new-trigger"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-fg shadow-soft-sm transition duration-base hover:-translate-y-px hover:bg-primary-hover"
        >
          <Icon name="plus" size={14} />
          {t("newTrigger")}
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
          <PageHeader
            title={t("title")}
            count={triggers.length || undefined}
            subtitle={
              <span className="inline-flex items-center gap-1.5">
                <Icon name="sparkles" size={13} className="text-accent" />
                {t("subtitle")}
              </span>
            }
          />

          <SummaryStrip
            total={stats.total}
            active={stats.active}
            firedToday={stats.firedToday}
            timers={stats.timers}
          />

          {status === "error" && (
            <div
              data-testid="triggers-error"
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3"
            >
              <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-danger">{t("loadFailed")}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
                  {error}
                </p>
              </div>
              <button
                onClick={() => void load()}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] text-text transition-colors duration-fast hover:bg-surface-2"
              >
                <Icon name="refresh" size={13} />
                {tCommon("retry")}
              </button>
            </div>
          )}

          {status === "loading" && (
            <div
              data-testid="triggers-loading"
              className="grid grid-cols-1 gap-3 xl:grid-cols-2"
            >
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[148px] animate-pulse rounded-lg border border-border bg-surface"
                />
              ))}
            </div>
          )}

          {status === "ready" && triggers.length > 0 && (
            <>
              <FilterChips
                value={filter}
                counts={filterCounts}
                onChange={setFilter}
              />

              {filtered.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
                  <p className="text-[13px] text-text-muted">
                    {t("emptyFilter")}
                  </p>
                </div>
              ) : (
                <div
                  data-testid="triggers-list"
                  className="grid grid-cols-1 gap-3 xl:grid-cols-2"
                >
                  {filtered.map((t) => (
                    <TriggerCard
                      key={t.id}
                      t={t}
                      busy={busyId === t.id}
                      firing={firingId === t.id}
                      onToggle={() => void handleToggle(t)}
                      onFire={() => void handleFire(t)}
                      onDelete={() => setDeleteTarget(t)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {status === "ready" && triggers.length === 0 && (
            <EmptyTriggers onCreate={openCreate} />
          )}
        </div>
      </div>

      <CreateDrawer
        key={drawerOpen ? "open" : "closed"}
        open={drawerOpen}
        initial={initialDraft}
        onClose={() => setDrawerOpen(false)}
        onCreated={async () => {
          setDrawerOpen(false);
          await load();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("deleteConfirm.title", { name: deleteTarget?.name ?? "" })}
        message={t("deleteConfirm.message")}
        confirmLabel={t("deleteConfirm.confirm")}
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteConfirmed()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary strip                                                              */
/* -------------------------------------------------------------------------- */

function SummaryStrip({
  total,
  active,
  firedToday,
  timers,
}: {
  total: number;
  active: number;
  firedToday: number;
  timers: number;
}) {
  const t = useTranslations("triggers.list.summary");
  return (
    <section
      data-testid="trigger-summary"
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
    >
      <HeroStat
        icon="zap"
        label={t("total")}
        value={total}
        hint={total === 0 ? t("totalEmpty") : t("totalActive", { count: active })}
      />
      <Stat
        icon="activity"
        label={t("active")}
        value={active}
        hint={total > 0 ? t("activePct", { pct: Math.round((active / Math.max(total, 1)) * 100) }) : undefined}
      />
      <Stat
        icon="check-circle-2"
        label={t("firedToday")}
        value={firedToday}
        tone="success"
      />
      <Stat icon="clock" label={t("timers")} value={timers} hint={t("timersHint")} />
    </section>
  );
}

function HeroStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: IconName;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-primary/30 bg-gradient-to-br from-primary to-primary-hover p-4 text-primary-fg shadow-soft">
      <div
        aria-hidden
        className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-2xl"
      />
      <div className="relative flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15 backdrop-blur-sm">
          <Icon name={icon} size={15} />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-primary-fg/80">
          {label}
        </span>
      </div>
      <div className="relative mt-3 flex items-baseline gap-2">
        <span className="font-mono text-[28px] font-semibold tabular-nums leading-none">
          {value}
        </span>
        {hint && (
          <span className="text-[11px] text-primary-fg/75">{hint}</span>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: IconName;
  label: string;
  value: number;
  hint?: string;
  tone?: "default" | "success";
}) {
  const toneCls =
    tone === "success"
      ? "text-success bg-success-soft"
      : "text-primary bg-primary/10";
  return (
    <div className="rounded-lg border border-border bg-surface p-4 transition duration-base hover:-translate-y-px hover:shadow-soft-sm">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${toneCls}`}>
          <Icon name={icon} size={14} />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-subtle">
          {label}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-mono text-[24px] font-semibold tabular-nums leading-none text-text">
          {value}
        </span>
        {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter chips                                                               */
/* -------------------------------------------------------------------------- */

function FilterChips({
  value,
  counts,
  onChange,
}: {
  value: FilterKey;
  counts: Record<FilterKey, number>;
  onChange: (v: FilterKey) => void;
}) {
  const t = useTranslations("triggers.list.filters");
  const items: { key: FilterKey; label: string; icon: IconName }[] = [
    { key: "all", label: t("all"), icon: "layout-grid" },
    { key: "timer", label: t("timer"), icon: "clock" },
    { key: "event", label: t("event"), icon: "zap" },
    { key: "disabled", label: t("disabled"), icon: "pause" },
  ];
  return (
    <div
      role="tablist"
      aria-label={t("ariaLabel")}
      className="flex flex-wrap items-center gap-1.5"
    >
      {items.map((it) => {
        const active = value === it.key;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            data-testid={`filter-${it.key}`}
            onClick={() => onChange(it.key)}
            className={
              active
                ? "inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[12px] font-medium text-primary shadow-soft-sm"
                : "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12px] text-text-muted transition-colors duration-fast hover:border-border-strong hover:text-text"
            }
          >
            <Icon name={it.icon} size={13} />
            {it.label}
            <span
              className={
                active
                  ? "rounded-sm bg-primary/15 px-1 font-mono text-[10px] tabular-nums"
                  : "font-mono text-[10px] tabular-nums text-text-subtle"
              }
            >
              {counts[it.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Trigger card                                                               */
/* -------------------------------------------------------------------------- */

function TriggerCard({
  t: trigger,
  busy,
  firing,
  onToggle,
  onFire,
  onDelete,
}: {
  t: Trigger;
  busy: boolean;
  firing: boolean;
  onToggle: () => void;
  onFire: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("triggers.list.card");
  const tActions = useTranslations("triggers.list.actions");
  const actionIcon = ACTION_ICON[trigger.action.type];
  const actionLabel = tActions(trigger.action.type);
  const kindIcon: IconName = trigger.kind === "timer" ? "clock" : "zap";
  const autoDisabled = !!trigger.auto_disabled_reason;
  const active = trigger.enabled && !autoDisabled;
  const scheduleText =
    trigger.kind === "timer"
      ? `${trigger.timer?.cron ?? ""} · ${trigger.timer?.timezone ?? "UTC"}`
      : trigger.event?.type ?? "";

  return (
    <div
      data-testid={`trigger-${trigger.id}`}
      className="group relative overflow-hidden rounded-lg border border-border bg-surface p-4 transition duration-base hover:-translate-y-px hover:shadow-soft"
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/60 via-primary to-accent"
        />
      )}

      <div className="flex items-start gap-3">
        <span
          className={
            active
              ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
              : "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted"
          }
        >
          <Icon name={kindIcon} size={18} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/triggers/${trigger.id}`}
              className="group/name min-w-0 flex-1"
              data-testid={`trigger-link-${trigger.id}`}
            >
              <h3 className="truncate text-[14px] font-semibold text-text transition-colors duration-fast group-hover/name:text-primary">
                {trigger.name}
              </h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-text-subtle">
                {scheduleText}
              </p>
            </Link>
            <ToggleSwitch
              enabled={trigger.enabled}
              busy={busy}
              onChange={onToggle}
              testId={`toggle-${trigger.id}`}
              disabled={autoDisabled}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-muted">
              <Icon name={kindIcon} size={11} />
              {trigger.kind}
            </span>
            <span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              <Icon name={actionIcon} size={11} />
              {actionLabel}
            </span>
            {autoDisabled && (
              <span
                className="inline-flex items-center gap-1 rounded-sm bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning"
                title={trigger.auto_disabled_reason ?? ""}
              >
                <Icon name="alert-triangle" size={11} />
                {t("autoDisabled")}
              </span>
            )}
            {trigger.fires_failed_streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger">
                <Icon name="alert-circle" size={11} />
                {t("failedStreak", { count: trigger.fires_failed_streak })}
              </span>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
            <span className="inline-flex items-center gap-1">
              <Icon name="activity" size={11} className="text-text-subtle" />
              {t("firesPrefix")} <span className="font-mono tabular-nums text-text">{trigger.fires_total}</span> {t("firesSuffix")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" size={11} className="text-text-subtle" />
              {trigger.last_fired_at ? (
                <>{t("lastPrefix")} <span className="font-mono text-text-subtle">{formatTime(trigger.last_fired_at)}</span></>
              ) : (
                t("neverFired")
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-1">
          <button
            onClick={onFire}
            disabled={firing || !active}
            data-testid={`fire-${trigger.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] text-text transition-colors duration-fast hover:border-border-strong hover:bg-surface-2 disabled:opacity-40"
          >
            <Icon name={firing ? "loader" : "play-circle"} size={13} className={firing ? "animate-spin" : ""} />
            {firing ? t("firing") : t("fireNow")}
          </button>
          <Link
            href={`/triggers/${trigger.id}`}
            data-testid={`edit-${trigger.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text"
          >
            <Icon name="edit" size={13} />
            {t("edit")}
          </Link>
        </div>
        <button
          onClick={onDelete}
          data-testid={`delete-${trigger.id}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-text-muted transition-colors duration-fast hover:bg-danger-soft hover:text-danger"
        >
          <Icon name="trash-2" size={13} />
          {t("delete")}
        </button>
      </div>
    </div>
  );
}

function ToggleSwitch({
  enabled,
  busy,
  onChange,
  testId,
  disabled = false,
}: {
  enabled: boolean;
  busy: boolean;
  onChange: () => void;
  testId?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("triggers.list.card");
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? t("switchOn") : t("switchOff")}
      data-testid={testId}
      onClick={onChange}
      disabled={busy || disabled}
      className={
        enabled
          ? "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-primary transition-colors duration-base disabled:opacity-40"
          : "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-surface-3 transition-colors duration-base disabled:opacity-40"
      }
    >
      <span
        aria-hidden
        className={
          enabled
            ? "inline-block h-4 w-4 translate-x-[18px] rounded-full bg-white shadow-soft-sm transition-transform duration-base"
            : "inline-block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-soft-sm transition-transform duration-base"
        }
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

function EmptyTriggers({
  onCreate,
}: {
  onCreate: (preset?: Partial<CreateDraft>) => void;
}) {
  const t = useTranslations("triggers.list.empty");
  const tCron = useTranslations("triggers.list.cron");
  return (
    <section
      data-testid="triggers-empty"
      className="relative overflow-hidden rounded-xl border border-dashed border-border bg-surface p-10 text-center"
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, var(--color-primary-glow) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-md">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-soft-sm">
          <Icon name="zap" size={24} />
        </div>
        <h2 className="text-[18px] font-semibold tracking-tight text-text">
          {t("title")}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[13px] text-text-muted">
          {t("description")}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {CRON_PRESETS.map((p) => {
            const label = tCron(p.hint);
            return (
              <button
                key={p.cron}
                data-testid={`preset-${p.hint}`}
                onClick={() =>
                  onCreate({ kind: "timer", cron: p.cron, name: label })
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] text-text transition duration-base hover:-translate-y-px hover:border-primary/40 hover:shadow-soft-sm"
              >
                <Icon name="clock" size={13} className="text-accent" />
                {label}
              </button>
            );
          })}
          <button
            onClick={() => onCreate({ kind: "event" })}
            data-testid="preset-event"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] text-text transition duration-base hover:-translate-y-px hover:border-primary/40 hover:shadow-soft-sm"
          >
            <Icon name="zap" size={13} className="text-accent" />
            {t("eventPreset")}
          </button>
        </div>
        <div className="mt-5">
          <button
            onClick={() => onCreate()}
            data-testid="empty-create"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-fg shadow-soft-sm transition duration-base hover:-translate-y-px hover:bg-primary-hover"
          >
            <Icon name="plus" size={14} />
            {t("customCreate")}
          </button>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Create modal                                                               */
/* -------------------------------------------------------------------------- */

function CreateDrawer({
  open,
  initial,
  onClose,
  onCreated,
}: {
  open: boolean;
  initial: CreateDraft;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const t = useTranslations("triggers.list.create");
  const tActions = useTranslations("triggers.list.actions");
  const [draft, setDraft] = useState<CreateDraft>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setErr("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, initial]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-trigger-title"
      onClick={onClose}
    >
      <div
        data-testid="create-drawer"
        className="flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-soft-lg"
        style={{ animation: "ah-fade-up 320ms cubic-bezier(.16,1,.3,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
              {t("eyebrow")}
            </p>
            <h3
              id="create-trigger-title"
              className="mt-0.5 text-[16px] font-semibold tracking-tight text-text"
            >
              {t("title")}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text"
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <Section label={t("sectionBasic")}>
            <Field
              label={t("fieldName")}
              value={draft.name}
              onChange={(v) => setDraft({ ...draft, name: v })}
              placeholder={t("fieldNamePlaceholder")}
            />

            <div>
              <MicroLabel>{t("fieldKind")}</MicroLabel>
              <div className="grid grid-cols-2 gap-2">
                <KindRadio
                  testId="kind-timer"
                  active={draft.kind === "timer"}
                  icon="clock"
                  title={t("kindTimerTitle")}
                  hint={t("kindTimerHint")}
                  onClick={() => setDraft({ ...draft, kind: "timer" })}
                />
                <KindRadio
                  testId="kind-event"
                  active={draft.kind === "event"}
                  icon="zap"
                  title={t("kindEventTitle")}
                  hint={t("kindEventHint")}
                  onClick={() => setDraft({ ...draft, kind: "event" })}
                />
              </div>
            </div>

            {draft.kind === "timer" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t("fieldCron")}
                  mono
                  value={draft.cron}
                  onChange={(v) => setDraft({ ...draft, cron: v })}
                  placeholder="0 8 * * *"
                />
                <Field
                  label={t("fieldTimezone")}
                  mono
                  value={draft.timezone}
                  onChange={(v) => setDraft({ ...draft, timezone: v })}
                  placeholder="UTC"
                />
              </div>
            ) : (
              <Field
                label={t("fieldEventType")}
                mono
                value={draft.event_type}
                onChange={(v) => setDraft({ ...draft, event_type: v })}
                placeholder="artifact.updated"
              />
            )}
          </Section>

          <Section label={t("sectionAction")}>
            <div>
              <MicroLabel>{t("fieldActionType")}</MicroLabel>
              <Select
                value={draft.action_type}
                onChange={(v) =>
                  setDraft({ ...draft, action_type: v as ActionType })
                }
                options={[
                  { value: "notify_user", label: tActions("notify_user"), hint: "notify_user" },
                  { value: "invoke_tool", label: tActions("invoke_tool"), hint: "invoke_tool" },
                  { value: "dispatch_employee", label: tActions("dispatch_employee"), hint: "dispatch_employee" },
                  { value: "continue_conversation", label: tActions("continue_conversation"), hint: "continue_conversation" },
                ]}
                testId="action-type"
                ariaLabel={t("fieldActionAria")}
                className="w-full"
              />
            </div>

            {draft.action_type === "notify_user" && (
              <Field
                label={t("fieldMessage")}
                value={draft.message}
                onChange={(v) => setDraft({ ...draft, message: v })}
                placeholder={t("fieldMessagePlaceholder")}
                textarea
              />
            )}
            {draft.action_type === "invoke_tool" && (
              <Field
                label={t("fieldToolId")}
                mono
                value={draft.tool_id}
                onChange={(v) => setDraft({ ...draft, tool_id: v })}
                placeholder="allhands.builtin.fetch_url"
              />
            )}
            {draft.action_type === "dispatch_employee" && (
              <>
                <Field
                  label={t("fieldEmployeeId")}
                  mono
                  value={draft.employee_id}
                  onChange={(v) => setDraft({ ...draft, employee_id: v })}
                  placeholder="emp_xxx"
                />
                <Field
                  label={t("fieldTaskTemplate")}
                  value={draft.task_template}
                  onChange={(v) => setDraft({ ...draft, task_template: v })}
                  placeholder={t("fieldTaskTemplatePlaceholder")}
                  textarea
                />
              </>
            )}
            {draft.action_type === "continue_conversation" && (
              <>
                <Field
                  label={t("fieldConversationId")}
                  mono
                  value={draft.conversation_id}
                  onChange={(v) => setDraft({ ...draft, conversation_id: v })}
                  placeholder="conv_xxx"
                />
                <Field
                  label={t("fieldMessageTemplate")}
                  value={draft.message_template}
                  onChange={(v) => setDraft({ ...draft, message_template: v })}
                  placeholder={t("fieldMessageTemplatePlaceholder")}
                  textarea
                />
              </>
            )}
          </Section>

          <Section label={t("sectionThrottle")}>
            <div>
              <MicroLabel>{t("fieldMinInterval")}</MicroLabel>
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
                className="h-10 w-full rounded-md border border-border bg-surface px-3 font-mono text-[13px] text-text transition-colors duration-fast focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
              />
            </div>
          </Section>

          {err && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-soft px-3 py-2"
            >
              <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0 text-danger" />
              <p
                className="font-mono text-[11px] text-danger"
                data-testid="create-error"
              >
                {err}
              </p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          <button
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-md px-3 text-[13px] text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text"
          >
            {t("cancel")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !draft.name.trim()}
            data-testid="create-submit"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-fg shadow-soft-sm transition duration-base hover:-translate-y-px hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <Icon
              name={submitting ? "loader" : "save"}
              size={14}
              className={submitting ? "animate-spin" : ""}
            />
            {submitting ? t("submitting") : t("submit")}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared form primitives                                                     */
/* -------------------------------------------------------------------------- */

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h4 className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
        {label}
      </h4>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-medium text-text-muted">
      {children}
    </label>
  );
}

function KindRadio({
  active,
  icon,
  title,
  hint,
  onClick,
  testId,
}: {
  active: boolean;
  icon: IconName;
  title: string;
  hint: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "flex items-start gap-2.5 rounded-lg border border-primary bg-primary/10 p-3 text-left shadow-soft-sm"
          : "flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-left transition-colors duration-fast hover:border-border-strong hover:bg-surface-2"
      }
    >
      <span
        className={
          active
            ? "mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-fg"
            : "mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-surface-2 text-text-muted"
        }
      >
        <Icon name={icon} size={14} />
      </span>
      <div className="min-w-0">
        <div
          className={
            active
              ? "text-[13px] font-medium text-primary"
              : "text-[13px] font-medium text-text"
          }
        >
          {title}
        </div>
        <div className="mt-0.5 text-[11px] text-text-muted">{hint}</div>
      </div>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
  textarea = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  textarea?: boolean;
}) {
  const baseCls =
    "w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle transition-colors duration-fast focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20";
  const monoCls = mono ? " font-mono" : "";
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      {textarea ? (
        <textarea
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={`${baseCls} py-2 leading-relaxed${monoCls}`}
        />
      ) : (
        <input
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${baseCls} h-10${monoCls}`}
        />
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
