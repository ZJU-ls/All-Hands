"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingState } from "@/components/state";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/icon";
import {
  createConversation,
  deleteEmployee,
  listEmployees,
  publishEmployee,
  restoreEmployee,
  type EmployeeDto,
  type EmployeeStatus,
} from "@/lib/api";
import { deriveProfile } from "@/lib/employee-profile";

/**
 * Employees · roster grid + status tabs + search + per-card quick actions.
 *
 * Phase 2 v3 (2026-04-27 mock employee-crud-overhaul.html):
 *   - State tabs (all / active / draft / archived) — counts derived from a
 *     single roster fetch with ``include_archived``-aware filter.
 *   - Search box · matches name / description / model / skill ids.
 *   - Card quick actions per status:
 *        published → chat · edit · soft-delete (archive)
 *        draft     → try · publish · edit · soft-delete
 *        archived  → restore · permanent-delete
 *     Lead Agent's delete buttons stay disabled (invariant).
 *
 * Single fetch loads everything (incl. archived) so tab switches are local
 * filter passes without round-trips. After mutations we refetch to stay
 * accurate against backend state (publish / archive / restore / hard delete).
 */

type StatusTab = "all" | "published" | "draft" | "archived";

const TAB_ORDER: readonly StatusTab[] = ["all", "published", "draft", "archived"];

function modelDisplay(modelRef: string, fallback: string): string {
  if (!modelRef) return fallback;
  const idx = modelRef.indexOf("/");
  return idx >= 0 ? modelRef.slice(idx + 1) : modelRef;
}

function avatarInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function matchesQuery(emp: EmployeeDto, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    emp.name.toLowerCase().includes(needle) ||
    (emp.description ?? "").toLowerCase().includes(needle) ||
    emp.model_ref.toLowerCase().includes(needle) ||
    emp.skill_ids.some((s) => s.toLowerCase().includes(needle))
  );
}

type PendingAction =
  | { kind: "archive"; employee: EmployeeDto }
  | { kind: "hard-delete"; employee: EmployeeDto };

export default function EmployeesPage() {
  const t = useTranslations("employees.list");
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StatusTab>("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  async function load(): Promise<EmployeeDto[] | null> {
    try {
      // Pull every status — including archived — in one call, so tab switches
      // are pure local filters. The backend default excludes archived so we
      // explicitly fetch the archived slice and merge.
      const [active, archived] = await Promise.all([
        listEmployees(),
        listEmployees({ status: "archived" }),
      ]);
      const merged = [...active, ...archived];
      setEmployees(merged);
      return merged;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fresh = await load();
      if (cancelled || fresh === null) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startChat(employeeId: string) {
    if (busyId) return;
    setBusyId(employeeId);
    setError(null);
    try {
      const conv = await createConversation(employeeId);
      router.push(`/chat/${conv.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusyId(null);
    }
  }

  async function handlePublish(employee: EmployeeDto) {
    if (busyId) return;
    setBusyId(employee.id);
    setError(null);
    try {
      await publishEmployee(employee.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(employee: EmployeeDto) {
    if (busyId) return;
    setBusyId(employee.id);
    setError(null);
    try {
      await restoreEmployee(employee.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    setConfirmBusy(true);
    setError(null);
    try {
      if (pending.kind === "archive") {
        await deleteEmployee(pending.employee.id);
      } else {
        await deleteEmployee(pending.employee.id, { hard: true });
      }
      await load();
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmBusy(false);
    }
  }

  const counts = useMemo(() => {
    const c = { all: 0, published: 0, draft: 0, archived: 0 };
    if (!employees) return c;
    for (const e of employees) {
      c.all += 1;
      if (e.status === "published") c.published += 1;
      else if (e.status === "draft") c.draft += 1;
      else if (e.status === "archived") c.archived += 1;
    }
    return c;
  }, [employees]);

  const visible = useMemo(() => {
    if (!employees) return null;
    return employees
      .filter((e) => activeTab === "all" || e.status === activeTab)
      .filter((e) => matchesQuery(e, query));
  }, [employees, activeTab, query]);

  return (
    <AppShell
      title={t("shellTitle")}
      actions={
        <Link
          href="/employees/new"
          data-testid="goto-employee-design"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-fg text-[12px] font-medium shadow-soft-sm hover:bg-primary-hover hover:-translate-y-px transition duration-base"
        >
          <Icon name="plus" size={14} strokeWidth={2.25} />
          {t("designAction")}
        </Link>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 space-y-5 animate-fade-up">
          <PageHeader
            title={t("pageTitle")}
            count={counts.all}
            subtitle={t("subtitle")}
          />

          <Toolbar
            activeTab={activeTab}
            counts={counts}
            onTab={setActiveTab}
            query={query}
            onQuery={setQuery}
          />

          {error && (
            <div
              data-testid="employees-error"
              className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger"
            >
              <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          {employees === null ? (
            <EmployeesSkeleton />
          ) : counts.all === 0 ? (
            <EmptyEmployees />
          ) : visible !== null && visible.length === 0 ? (
            <EmptyFiltered query={query} tab={activeTab} />
          ) : (
            <div
              data-testid="employees-grid"
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
            >
              {(visible ?? []).map((e) => (
                <EmployeeCard
                  key={e.id}
                  employee={e}
                  busy={busyId === e.id}
                  anyBusy={busyId !== null}
                  onStartChat={() => void startChat(e.id)}
                  onPublish={() => void handlePublish(e)}
                  onRestore={() => void handleRestore(e)}
                  onArchive={() => setPending({ kind: "archive", employee: e })}
                  onHardDelete={() =>
                    setPending({ kind: "hard-delete", employee: e })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === "hard-delete"
            ? t("hardDeleteTitle", { name: pending.employee.name })
            : t("archiveTitle", { name: pending?.employee.name ?? "" })
        }
        message={
          pending?.kind === "hard-delete"
            ? t("hardDeleteMessage")
            : t("archiveMessage")
        }
        confirmLabel={
          pending?.kind === "hard-delete" ? t("hardDeleteConfirm") : t("archiveConfirm")
        }
        danger
        busy={confirmBusy}
        onConfirm={() => void confirmPending()}
        onCancel={() => (confirmBusy ? undefined : setPending(null))}
      />
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar (tabs + search)
// ─────────────────────────────────────────────────────────────────────────────

function Toolbar({
  activeTab,
  counts,
  onTab,
  query,
  onQuery,
}: {
  activeTab: StatusTab;
  counts: Record<StatusTab, number>;
  onTab: (tab: StatusTab) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  const t = useTranslations("employees.list.toolbar");
  return (
    <div
      data-testid="employees-toolbar"
      className="flex items-center gap-3 flex-wrap"
    >
      <div
        role="tablist"
        aria-label={t("tabsAria")}
        className="inline-flex p-0.5 rounded-lg border border-border bg-surface-2"
      >
        {TAB_ORDER.map((tab) => {
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`employees-tab-${tab}`}
              onClick={() => onTab(tab)}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] transition-colors duration-fast ${
                active
                  ? "bg-surface text-text font-semibold shadow-soft-sm"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <span>{t(`tabs.${tab}`)}</span>
              <span
                className={`inline-flex items-center h-4 px-1.5 rounded font-mono text-[10px] ${
                  active
                    ? "bg-primary-muted text-primary"
                    : "bg-surface-3 text-text-subtle"
                }`}
              >
                {counts[tab]}
              </span>
            </button>
          );
        })}
      </div>

      <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-surface text-[12px] text-text-muted focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 transition duration-fast min-w-[200px] flex-1 max-w-md">
        <Icon name="search" size={13} className="text-text-subtle shrink-0" />
        <input
          type="search"
          data-testid="employees-search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-text-subtle text-[12.5px] text-text"
        />
      </label>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee card · grouped quick actions per status
// ─────────────────────────────────────────────────────────────────────────────

function EmployeeCard({
  employee,
  busy,
  anyBusy,
  onStartChat,
  onPublish,
  onRestore,
  onArchive,
  onHardDelete,
}: {
  employee: EmployeeDto;
  busy: boolean;
  anyBusy: boolean;
  onStartChat: () => void;
  onPublish: () => void;
  onRestore: () => void;
  onArchive: () => void;
  onHardDelete: () => void;
}) {
  const t = useTranslations("employees.list");
  const badgeT = useTranslations("employeeBadges");
  const badges = deriveProfile(employee).filter((b) => b !== "react");
  const isLead = employee.is_lead_agent;
  const isArchived = employee.status === "archived";
  const isDraft = employee.status === "draft";

  const cardClass = isArchived
    ? "group relative flex flex-col gap-3 rounded-xl bg-surface-2 border border-border shadow-soft-sm p-5 min-w-0 opacity-80"
    : isLead
      ? "group relative flex flex-col gap-3 rounded-xl bg-gradient-to-br from-primary/10 via-surface to-surface border border-primary/40 shadow-soft-lg p-5 hover:-translate-y-px transition duration-base min-w-0"
      : "group relative flex flex-col gap-3 rounded-xl bg-surface border border-border shadow-soft-sm hover:shadow-soft hover:-translate-y-px hover:border-border-strong transition duration-base p-5 min-w-0";

  const avatarBg = isArchived
    ? "linear-gradient(135deg, var(--color-surface-3), var(--color-border))"
    : "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))";

  return (
    <div
      data-testid={`employee-card-${employee.name}`}
      data-status={employee.status}
      className={cardClass}
    >
      <span
        className="absolute top-4 right-4 flex items-center gap-1.5"
        aria-hidden={false}
      >
        {isLead && (
          <span
            className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-primary text-primary-fg text-caption font-medium shadow-soft-sm"
            data-testid="badge-lead"
          >
            <Icon name="sparkles" size={10} />
            {t("leadBadge")}
          </span>
        )}
        <StatusChip status={employee.status} />
      </span>

      <Link
        href={`/employees/${employee.id}`}
        data-testid={`employee-card-detail-${employee.name}`}
        className="flex items-start gap-3 text-left"
      >
        <div
          className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-primary-fg shadow-soft-sm shrink-0"
          style={{ background: avatarBg }}
          aria-hidden="true"
        >
          {avatarInitials(employee.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0 pr-32">
            <span className="text-[14px] font-semibold text-text truncate tracking-tight">
              {employee.name}
            </span>
          </div>
          <p className="font-mono text-[11px] text-text-subtle truncate mt-0.5">
            {modelDisplay(employee.model_ref, t("defaultModel")) || t("fallbackModel")}
          </p>
        </div>
      </Link>

      {employee.description ? (
        <p className="text-[12px] text-text-muted leading-snug line-clamp-2 min-h-[32px]">
          {employee.description}
        </p>
      ) : (
        <p className="text-[12px] text-text-subtle italic leading-snug min-h-[32px]">
          {t("noDescription")}
        </p>
      )}

      {badges.length > 0 && !isArchived && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {badges.map((b) => (
            <span
              key={b}
              className="inline-flex items-center h-5 px-2 rounded-full bg-surface-2 text-text-muted text-caption font-medium border border-border"
            >
              {badgeT(b)}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 pt-3 mt-auto border-t border-border flex-wrap">
        <Stat icon="zap" label="tools" value={employee.tool_ids.length} />
        <Stat icon="wand-2" label="skills" value={employee.skill_ids.length} />

        <div className="ml-auto flex items-center gap-1.5">
          {isArchived ? (
            <>
              <button
                type="button"
                onClick={onRestore}
                disabled={anyBusy}
                data-testid={`employee-card-restore-${employee.name}`}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-60 transition duration-base"
              >
                {busy ? (
                  <Icon name="loader" size={12} className="animate-spin-slow" />
                ) : (
                  <Icon name="refresh" size={12} strokeWidth={2.25} />
                )}
                {t("restore")}
              </button>
              <button
                type="button"
                onClick={onHardDelete}
                disabled={anyBusy || isLead}
                data-testid={`employee-card-hard-delete-${employee.name}`}
                title={isLead ? t("leadCannotDelete") : t("hardDeleteHint")}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-danger/40 px-2 text-[11px] font-medium text-danger hover:bg-danger-soft disabled:opacity-30 transition duration-base"
              >
                <Icon name="trash-2" size={11} strokeWidth={2.25} />
                {t("hardDelete")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onStartChat}
                disabled={anyBusy}
                aria-label={t("startChatAria", { name: employee.name })}
                data-testid={`employee-card-chat-${employee.name}`}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-60 transition duration-base"
              >
                {busy ? (
                  <>
                    <Icon name="loader" size={12} className="animate-spin-slow" />
                    {t("opening")}
                  </>
                ) : (
                  <>
                    {isDraft ? t("tryEmployee") : t("chat")}
                    <Icon
                      name="arrow-right"
                      size={12}
                      className="group-hover:translate-x-0.5 transition duration-base"
                    />
                  </>
                )}
              </button>
              {isDraft && (
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={anyBusy}
                  data-testid={`employee-card-publish-${employee.name}`}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-40 transition duration-base"
                >
                  <Icon name="check-circle-2" size={11} strokeWidth={2} />
                  {t("publish")}
                </button>
              )}
              <button
                type="button"
                onClick={onArchive}
                disabled={anyBusy || isLead}
                data-testid={`employee-card-archive-${employee.name}`}
                title={isLead ? t("leadCannotDelete") : t("archiveHint")}
                aria-label={t("archive")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-subtle hover:text-danger hover:border-danger/40 disabled:opacity-30 transition duration-base"
              >
                <Icon name="trash-2" size={11} strokeWidth={2} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: EmployeeStatus }) {
  const t = useTranslations("employees.list");
  const className =
    status === "draft"
      ? "bg-warning-soft text-warning"
      : status === "archived"
        ? "bg-surface-3 text-text-subtle"
        : "bg-success-soft text-success";
  const label =
    status === "draft"
      ? t("statusDraft")
      : status === "archived"
        ? t("statusArchived")
        : t("statusPublished");
  return (
    <span
      data-testid={`employee-card-status-${status}`}
      className={`inline-flex items-center gap-1 h-5 px-2 rounded-full font-mono text-caption font-semibold uppercase tracking-wider ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "draft"
            ? "bg-warning"
            : status === "archived"
              ? "bg-text-subtle"
              : "bg-success"
        }`}
      />
      {label}
    </span>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: "zap" | "wand-2";
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-muted">
      <Icon name={icon} size={12} className="text-text-subtle" />
      <span className="text-[13px] font-semibold text-text tabular-nums">
        {value}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
        {label}
      </span>
    </span>
  );
}

function EmployeesSkeleton() {
  const t = useTranslations("employees.list");
  const loadingLabel = t("loadingEmployees");
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="rounded-xl bg-surface border border-border shadow-soft-sm p-5 space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-surface-3 animate-shimmer bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 rounded bg-surface-3 animate-shimmer bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]" />
              <div className="h-2.5 w-20 rounded bg-surface-2" />
            </div>
          </div>
          <div className="h-2.5 w-full rounded bg-surface-2" />
          <div className="h-2.5 w-4/5 rounded bg-surface-2" />
          <div className="pt-3 border-t border-border flex gap-3">
            <div className="h-4 w-12 rounded bg-surface-2" />
            <div className="h-4 w-12 rounded bg-surface-2" />
            <div className="ml-auto h-6 w-16 rounded bg-surface-2" />
          </div>
        </div>
      ))}
      <span className="sr-only">
        <LoadingState title={loadingLabel} />
      </span>
    </div>
  );
}

function EmptyFiltered({ query, tab }: { query: string; tab: StatusTab }) {
  const t = useTranslations("employees.list");
  const heading =
    query.trim().length > 0
      ? t("emptyFiltered.searchHeading", { query })
      : t(`emptyFiltered.tabHeading.${tab}`);
  return (
    <div
      data-testid="employees-empty-filtered"
      className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center"
    >
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-text-muted">
        <Icon name="search" size={20} strokeWidth={1.5} />
      </div>
      <p className="text-[13px] text-text">{heading}</p>
      <p className="mt-1 text-[12px] text-text-muted">
        {t("emptyFiltered.body")}
      </p>
    </div>
  );
}

function EmptyEmployees() {
  const t = useTranslations("employees.list");
  return (
    <div
      data-testid="employees-empty"
      className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-sm"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70 pointer-events-none"
        style={{
          background:
            "radial-gradient(600px 300px at 15% 20%, var(--color-primary-muted), transparent 60%), radial-gradient(500px 400px at 85% 60%, color-mix(in srgb, var(--color-accent, var(--color-primary)) 18%, transparent), transparent 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      <div className="relative px-6 py-16 grid place-items-center text-center">
        <div
          className="grid h-20 w-20 place-items-center rounded-2xl text-primary-fg shadow-soft-lg animate-float"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name="users" size={36} strokeWidth={1.5} />
        </div>

        <h3 className="mt-6 text-display font-bold tracking-tight text-text">
          {t("emptyHeading")}
        </h3>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-text-muted">
          {t("emptyBodyPrefix")}
          <span className="font-mono text-text">create_employee</span>
          {t("emptyBodySuffix")}
        </p>

        <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
          <Link
            href="/chat"
            data-testid="employees-empty-cta-hire"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-primary text-primary-fg text-[13px] font-semibold shadow-soft hover:bg-primary-hover hover:-translate-y-px transition duration-base"
          >
            <Icon name="sparkles" size={14} />
            {t("hireEmployee")}
          </Link>
          <Link
            href="/employees/new"
            data-testid="employees-empty-cta-design"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-surface border border-border text-[13px] font-semibold text-text hover:border-primary hover:text-primary hover:-translate-y-px transition duration-base"
          >
            <Icon name="wand-2" size={14} />
            {t("openDesigner")}
          </Link>
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-text-subtle flex-wrap">
          <span className="font-mono uppercase tracking-wider">{t("popularStarts")}</span>
          <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-surface-2 border border-border text-text-muted font-medium">
            Sales Analyst
          </span>
          <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-surface-2 border border-border text-text-muted font-medium">
            Content Maker
          </span>
          <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-surface-2 border border-border text-text-muted font-medium">
            Research Buddy
          </span>
        </div>
      </div>
    </div>
  );
}
