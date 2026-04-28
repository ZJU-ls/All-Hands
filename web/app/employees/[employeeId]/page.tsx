"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/icon";
import { DesignForm } from "@/components/employee-design/DesignForm";
import {
  createConversation,
  deleteEmployee,
  getEmployee,
  listConversations,
  listMcpServers,
  listSkills,
  publishEmployee,
  restoreEmployee,
  type ConversationDto,
  type EmployeeDto,
  type McpServerDto,
  type SkillDto,
} from "@/lib/api";
import { deriveProfile } from "@/lib/employee-profile";

/**
 * Employee detail · employee-centric single-employee dashboard.
 *
 * Phase 2 layout (ADR 0016 V2 + 2026-04-27 v2 mock):
 *   1. Hero card — avatar / name / status / description / capability chips +
 *      action cluster (start chat · edit · dispatch).
 *   2. KPI strip — conversations · skills · tools · max_iter cards.
 *   3. Tabs — Overview / Config / Files. Overview pulls in skills + prompt +
 *      recent conversations. Config hosts <DesignForm initial={...} /> plus the
 *      publish / try / delete lifecycle toolbar that used to live on
 *      /employees/design. Files is a placeholder pending Phase 3.
 *
 * The hero "Edit" button switches to the Config tab in-place (`?tab=config`)
 * so we never leave the page just to tweak a field.
 */

type TabKey = "overview" | "config" | "files";
const VALID_TABS: readonly TabKey[] = ["overview", "config", "files"];

function isTab(value: string | null): value is TabKey {
  return value !== null && (VALID_TABS as readonly string[]).includes(value);
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

function modelDisplay(modelRef: string, fallback: string): string {
  if (!modelRef) return fallback;
  const idx = modelRef.indexOf("/");
  return idx >= 0 ? modelRef.slice(idx + 1) : modelRef;
}

export default function EmployeePage() {
  return (
    // useSearchParams must run inside a Suspense boundary in app router.
    <Suspense fallback={<EmployeeShellFallback />}>
      <EmployeePageInner />
    </Suspense>
  );
}

function EmployeeShellFallback() {
  const t = useTranslations("employees.detail");
  return (
    <AppShell title={t("shellTitleFallback")}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <LoadingState title={t("loadingEmployee")} />
        </div>
      </div>
    </AppShell>
  );
}

function EmployeePageInner() {
  const t = useTranslations("employees.detail");
  const badgeT = useTranslations("employeeBadges");
  const locale = useLocale();
  const { employeeId } = useParams<{ employeeId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = isTab(tabParam) ? tabParam : "overview";

  const [employee, setEmployee] = useState<EmployeeDto | null>(null);
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [skills, setSkills] = useState<SkillDto[] | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyAction, setBusyAction] = useState<
    "publish" | "delete" | "restore" | null
  >(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [hardDeleteOpen, setHardDeleteOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [e, c, sk, mcp] = await Promise.all([
        getEmployee(employeeId),
        listConversations({ employeeId }),
        listSkills().catch(() => [] as SkillDto[]),
        listMcpServers().catch(() => [] as McpServerDto[]),
      ]);
      setEmployee(e);
      setConversations(c);
      setSkills(sk);
      setMcpServers(mcp);
    } catch (err) {
      setError(String(err));
    }
  }, [employeeId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [e, c, sk, mcp] = await Promise.all([
          getEmployee(employeeId),
          listConversations({ employeeId }),
          listSkills().catch(() => [] as SkillDto[]),
          listMcpServers().catch(() => [] as McpServerDto[]),
        ]);
        if (cancelled) return;
        setEmployee(e);
        setConversations(c);
        setSkills(sk);
        setMcpServers(mcp);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const setTab = useCallback(
    (next: TabKey) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "overview") {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      const qs = params.toString();
      router.replace(`/employees/${employeeId}${qs ? `?${qs}` : ""}`, {
        scroll: false,
      });
    },
    [employeeId, router, searchParams],
  );

  async function handleNewConversation() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await createConversation(employeeId);
      router.push(`/chat/${res.id}`);
    } catch (err) {
      setError(String(err));
      setCreating(false);
    }
  }

  async function handlePublish() {
    if (!employee) return;
    setBusyAction("publish");
    setError(null);
    try {
      await publishEmployee(employee.id);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestore() {
    if (!employee) return;
    setBusyAction("restore");
    setError(null);
    try {
      await restoreEmployee(employee.id);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmArchive() {
    if (!employee) return;
    setBusyAction("delete");
    setError(null);
    try {
      // Default DELETE → soft delete (archive). Detail page stays mounted so
      // the user can see the archived state + 「重新聘用」 banner without
      // bouncing back to the list.
      await deleteEmployee(employee.id);
      setDeleteOpen(false);
      await reload();
    } catch (e) {
      setError(String(e));
      setDeleteOpen(false);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmHardDelete() {
    if (!employee) return;
    setBusyAction("delete");
    setError(null);
    try {
      await deleteEmployee(employee.id, { hard: true });
      router.push("/employees");
    } catch (e) {
      setError(String(e));
      setBusyAction(null);
      setHardDeleteOpen(false);
    }
  }

  const badges = useMemo(
    () => (employee ? deriveProfile(employee).filter((b) => b !== "react") : []),
    [employee],
  );
  const isLead = Boolean(employee?.is_lead_agent);

  return (
    <AppShell
      title={employee?.name ?? t("shellTitleFallback")}
      actions={
        <Link
          href="/employees"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition-colors duration-fast"
        >
          <Icon name="arrow-left" size={12} />
          {t("backToList")}
        </Link>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          {error && (
            <div
              data-testid="employee-detail-error"
              className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger"
            >
              <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          {employee === null && !error ? (
            <LoadingState title={t("loadingEmployee")} />
          ) : employee ? (
            <>
              {employee.status === "archived" && (
                <ArchivedBanner
                  busy={busyAction === "restore"}
                  onRestore={() => void handleRestore()}
                  onHardDelete={() => setHardDeleteOpen(true)}
                />
              )}

              <HeroCard
                employee={employee}
                isLead={isLead}
                creating={creating}
                onNewConversation={() => void handleNewConversation()}
                onEdit={() => setTab("config")}
              />

              <MetaStrip
                employee={employee}
                conversationCount={conversations?.length ?? 0}
              />

              <TabBar active={activeTab} onSelect={setTab} />

              {activeTab === "overview" && (
                <OverviewPane
                  employee={employee}
                  skills={skills}
                  conversations={conversations}
                  badges={badges}
                  badgeT={badgeT}
                  locale={locale}
                  creating={creating}
                  onNewConversation={() => void handleNewConversation()}
                />
              )}

              {activeTab === "config" && (
                <ConfigPane
                  employee={employee}
                  skills={skills}
                  mcpServers={mcpServers}
                  busyAction={busyAction}
                  onPublish={() => void handlePublish()}
                  onDelete={() => setDeleteOpen(true)}
                  onTry={() => void handleNewConversation()}
                  onSaved={async () => {
                    await reload();
                  }}
                />
              )}

              {activeTab === "files" && <FilesPane employeeName={employee.name} />}
            </>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title={t("deleteTitle", { name: employee?.name ?? "" })}
        message={t("deleteMessage")}
        confirmLabel={t("deleteConfirm")}
        danger
        busy={busyAction === "delete"}
        onConfirm={() => void handleConfirmArchive()}
        onCancel={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={hardDeleteOpen}
        title={t("hardDeleteTitle", { name: employee?.name ?? "" })}
        message={t("hardDeleteMessage")}
        confirmLabel={t("hardDeleteConfirm")}
        danger
        busy={busyAction === "delete"}
        onConfirm={() => void handleConfirmHardDelete()}
        onCancel={() => setHardDeleteOpen(false)}
      />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Archived banner — only rendered for status=archived
// ---------------------------------------------------------------------------

function ArchivedBanner({
  busy,
  onRestore,
  onHardDelete,
}: {
  busy: boolean;
  onRestore: () => void;
  onHardDelete: () => void;
}) {
  const t = useTranslations("employees.detail");
  return (
    <section
      data-testid="employee-archived-banner"
      className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3"
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-warning/15 text-warning shrink-0">
        <Icon name="folder" size={14} strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-text">
          {t("archivedTitle")}
        </p>
        <p className="mt-0.5 text-[12px] text-text-muted">
          {t("archivedBody")}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onRestore}
          disabled={busy}
          data-testid="employee-archived-restore"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-60 transition duration-base"
        >
          {busy ? (
            <Icon name="loader" size={12} className="animate-spin" />
          ) : (
            <Icon name="refresh" size={12} strokeWidth={2.25} />
          )}
          {t("restore")}
        </button>
        <button
          type="button"
          onClick={onHardDelete}
          disabled={busy}
          data-testid="employee-archived-hard-delete"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/40 px-3 text-[12px] font-medium text-danger hover:bg-danger-soft disabled:opacity-30 transition duration-base"
        >
          <Icon name="trash-2" size={12} strokeWidth={2} />
          {t("hardDelete")}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hero card
// ---------------------------------------------------------------------------

function HeroCard({
  employee,
  isLead,
  creating,
  onNewConversation,
  onEdit,
}: {
  employee: EmployeeDto;
  isLead: boolean;
  creating: boolean;
  onNewConversation: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("employees.detail");
  return (
    <section
      data-testid="employee-hero"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-surface to-surface border border-primary/20 shadow-soft-lg p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl opacity-60"
        style={{ background: "var(--color-primary-glow)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/70 via-primary to-accent"
      />

      <div className="relative flex items-start gap-5 flex-wrap">
        <div
          className="grid h-16 w-16 place-items-center rounded-2xl text-primary-fg text-[20px] font-bold tracking-tight shadow-soft shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          {avatarInitials(employee.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] font-semibold tracking-tight text-text truncate">
              {employee.name}
            </h1>
            {isLead && (
              <span
                data-testid="employee-hero-lead"
                className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-primary text-primary-fg text-caption font-medium shadow-soft-sm"
              >
                <Icon name="sparkles" size={10} />
                {t("leadBadge")}
              </span>
            )}
            <span
              data-testid={`employee-hero-status-${employee.status}`}
              className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-caption font-mono font-semibold uppercase tracking-wider ${
                employee.status === "draft"
                  ? "bg-warning-soft text-warning"
                  : employee.status === "archived"
                    ? "bg-surface-3 text-text-subtle"
                    : "bg-success-soft text-success"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  employee.status === "draft"
                    ? "bg-warning"
                    : employee.status === "archived"
                      ? "bg-text-subtle"
                      : "bg-success"
                }`}
              />
              {employee.status === "draft"
                ? t("statusDraft")
                : employee.status === "archived"
                  ? t("statusArchived")
                  : t("statusPublished")}
            </span>
          </div>
          {employee.description ? (
            <p className="mt-2 text-[13px] text-text-muted leading-relaxed max-w-2xl">
              {employee.description}
            </p>
          ) : (
            <p className="mt-2 text-[13px] text-text-subtle italic">
              {t("noDescription")}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-surface-2 border border-border font-mono text-caption text-text-muted">
              <Icon name="brain" size={11} strokeWidth={2} />
              {modelDisplay(employee.model_ref, t("defaultModel"))}
            </span>
            <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-surface-2 border border-border font-mono text-caption text-text-muted">
              <Icon name="zap" size={11} strokeWidth={2} />
              {employee.tool_ids.length} {t("toolsLabel")}
            </span>
            <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-surface-2 border border-border font-mono text-caption text-text-muted">
              <Icon name="refresh" size={11} strokeWidth={2} />
              {employee.max_iterations} {t("iterationsSuffix")}
            </span>
          </div>
        </div>

        {employee.status !== "archived" && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onNewConversation}
              disabled={creating}
              data-testid="employee-hero-chat"
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-primary-fg text-[13px] font-semibold shadow-soft hover:-translate-y-px transition duration-base disabled:opacity-60"
            >
              {creating ? (
                <>
                  <Icon name="loader" size={14} className="animate-spin" />
                  {t("openingChat")}
                </>
              ) : (
                <>
                  <Icon name="send" size={14} />
                  {t("startChat")}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onEdit}
              data-testid="employee-hero-edit"
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-border bg-surface text-[13px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
            >
              <Icon name="edit" size={14} />
              {t("edit")}
            </button>
            <Link
              href={`/chat?prefill=${encodeURIComponent(
                t("dispatchPrefill", { name: employee.name }),
              )}`}
              data-testid="employee-hero-dispatch"
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-border bg-surface text-[13px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
            >
              <Icon name="share-2" size={14} />
              {t("dispatch")}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function MetaStrip({
  employee,
  conversationCount,
}: {
  employee: EmployeeDto;
  conversationCount: number;
}) {
  const t = useTranslations("employees.detail");
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <HeroKpi
        label={t("kpiConversations")}
        value={conversationCount.toString()}
        icon="message-square"
        hint={t("kpiConversationsHint")}
      />
      <StatKpi
        label={t("kpiSkills")}
        value={employee.skill_ids.length}
        icon="wand-2"
        hint={t("kpiSkillsHint")}
      />
      <StatKpi
        label={t("kpiTools")}
        value={employee.tool_ids.length}
        icon="zap"
        hint={t("kpiToolsHint")}
      />
      <StatKpi
        label={t("kpiMaxIter")}
        value={employee.max_iterations}
        icon="refresh"
        hint={t("kpiMaxIterHint")}
        monoHint
      />
    </div>
  );
}

function HeroKpi({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: string;
  icon: "message-square";
  hint?: string;
}) {
  return (
    <div
      data-testid={`employee-kpi-${label.toLowerCase()}`}
      className="group relative overflow-hidden rounded-xl p-4 text-primary-fg shadow-soft transition duration-base hover:-translate-y-px hover:shadow-soft-lg"
      style={{
        background:
          "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl"
        style={{ background: "var(--color-primary-glow)", opacity: 0.4 }}
      />
      <div className="relative flex items-center justify-between">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider opacity-90">
          {label}
        </span>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
      </div>
      <div className="relative mt-3 text-xl font-bold tabular-nums leading-none">
        {value}
      </div>
      {hint && (
        <div className="relative mt-2 font-mono text-caption opacity-85 truncate">
          {hint}
        </div>
      )}
    </div>
  );
}

function StatKpi({
  label,
  value,
  icon,
  hint,
  monoHint = false,
}: {
  label: string;
  value: number | string;
  icon: "wand-2" | "zap" | "refresh";
  hint?: string;
  monoHint?: boolean;
}) {
  return (
    <div
      data-testid={`employee-kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className="group relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft hover:border-border-strong"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text-subtle truncate">
          {label}
        </span>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-muted text-primary">
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
      </div>
      <div className="text-xl font-bold tabular-nums leading-none text-text">
        {value}
      </div>
      {hint && (
        <div
          className={`text-caption text-text-subtle truncate ${
            monoHint ? "font-mono" : ""
          }`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function TabBar({
  active,
  onSelect,
}: {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
}) {
  const t = useTranslations("employees.detail.tabs");
  const tabs: { key: TabKey; icon: "list" | "settings" | "folder" }[] = [
    { key: "overview", icon: "list" },
    { key: "config", icon: "settings" },
    { key: "files", icon: "folder" },
  ];
  return (
    <nav
      data-testid="employee-detail-tabs"
      role="tablist"
      aria-label={t("ariaLabel")}
      className="flex gap-1 border-b border-border"
    >
      {tabs.map(({ key, icon }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`employee-detail-tab-${key}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => onSelect(key)}
            className={`-mb-px inline-flex items-center gap-1.5 h-9 px-3 border-b-2 text-[12.5px] transition-colors duration-fast ${
              isActive
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            <Icon name={icon} size={13} strokeWidth={2} />
            {t(key)}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Overview tab · skills + prompt + recent conversations
// ---------------------------------------------------------------------------

function OverviewPane({
  employee,
  skills,
  conversations,
  badges,
  badgeT,
  locale,
  creating,
  onNewConversation,
}: {
  employee: EmployeeDto;
  skills: SkillDto[] | null;
  conversations: ConversationDto[] | null;
  badges: string[];
  badgeT: (key: string) => string;
  locale: string;
  creating: boolean;
  onNewConversation: () => void;
}) {
  const t = useTranslations("employees.detail");
  const skillNameById = useMemo(() => {
    const m = new Map<string, string>();
    (skills ?? []).forEach((s) => m.set(s.id, s.name));
    return m;
  }, [skills]);
  return (
    <div data-testid="employee-tab-overview" className="space-y-6">
      <Section
        title={t("skillsTitle")}
        subtitle={t("skillsSubtitle", { count: employee.skill_ids.length })}
        icon="wand-2"
      >
        {employee.skill_ids.length === 0 ? (
          <p className="text-[12px] text-text-subtle italic">{t("skillsEmpty")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {employee.skill_ids.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-primary-muted text-primary text-caption font-medium"
                title={id}
              >
                <Icon name="sparkles" size={10} strokeWidth={2} />
                {skillNameById.get(id) ?? id.replace(/^allhands\.(skills|builtin)\./, "")}
              </span>
            ))}
          </div>
        )}
        {badges.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-caption uppercase tracking-wider text-text-subtle">
              {t("profileLabel")}
            </span>
            {badges.map((b) => (
              <span
                key={b}
                className="inline-flex items-center h-5 px-2 rounded-full bg-surface-2 border border-border text-text-muted text-caption font-medium"
              >
                {badgeT(b)}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={t("promptTitle")}
        subtitle={t("promptSubtitle")}
        icon="file-code-2"
      >
        {employee.system_prompt?.trim() ? (
          <pre className="rounded-lg bg-surface-2 border border-border p-4 text-[12px] font-mono text-text whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
            {employee.system_prompt}
          </pre>
        ) : (
          <p className="text-[12px] text-text-subtle italic">{t("promptEmpty")}</p>
        )}
      </Section>

      <Section
        title={t("conversationsTitle")}
        subtitle={
          conversations === null
            ? t("conversationsLoading")
            : conversations.length === 0
              ? t("conversationsEmpty")
              : t("conversationsCount", { count: conversations.length })
        }
        icon="message-square"
        actions={
          <button
            type="button"
            onClick={onNewConversation}
            disabled={creating || !employee}
            data-testid="employee-detail-new-conversation"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium bg-primary hover:bg-primary-hover text-primary-fg shadow-soft-sm transition-colors duration-fast disabled:opacity-60"
          >
            {creating ? (
              <>
                <Icon name="loader" size={12} className="animate-spin" />
                {t("creating")}
              </>
            ) : (
              <>
                <Icon name="plus" size={12} strokeWidth={2.25} />
                {t("newConversation")}
              </>
            )}
          </button>
        }
      >
        {conversations === null ? (
          <ConversationsSkeleton />
        ) : conversations.length === 0 ? (
          <EmptyConversations employeeName={employee.name} />
        ) : (
          <ul className="space-y-2">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  className="group flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-soft-sm hover:-translate-y-px hover:shadow-soft hover:border-border-strong transition duration-base"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-muted text-primary shrink-0">
                    <Icon name="message-square" size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-text truncate">
                      {c.title ?? t("untitled")}
                    </p>
                    <p className="mt-0.5 text-caption text-text-subtle truncate">
                      {new Date(c.created_at).toLocaleString(locale)}
                    </p>
                  </div>
                  <Icon
                    name="arrow-right"
                    size={14}
                    className="mt-1 text-text-subtle group-hover:text-primary group-hover:translate-x-0.5 transition duration-base"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config tab · DesignForm + lifecycle toolbar (publish · try · delete)
// ---------------------------------------------------------------------------

function ConfigPane({
  employee,
  skills,
  mcpServers,
  busyAction,
  onPublish,
  onDelete,
  onTry,
  onSaved,
}: {
  employee: EmployeeDto;
  skills: SkillDto[] | null;
  mcpServers: McpServerDto[] | null;
  busyAction: "publish" | "delete" | "restore" | null;
  onPublish: () => void;
  onDelete: () => void;
  onTry: () => void;
  onSaved: (emp: EmployeeDto) => Promise<void> | void;
}) {
  const t = useTranslations("employees.detail");
  const isDraft = employee.status === "draft";
  const isArchived = employee.status === "archived";
  const busy = busyAction !== null;
  return (
    <div data-testid="employee-tab-config" className="space-y-5">
      <section
        data-testid="employee-config-toolbar"
        className="rounded-xl border border-border bg-surface shadow-soft-sm p-4"
      >
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-text">
              {t("configHeading")}
            </h2>
            <p className="mt-0.5 text-caption text-text-muted">
              {t("configSubtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isArchived && (
              <button
                type="button"
                onClick={onTry}
                disabled={busy}
                data-testid="employee-config-try"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base disabled:opacity-40"
              >
                <Icon name="play" size={12} strokeWidth={2.25} />
                {t("tryEmployee")}
              </button>
            )}
            {isDraft && (
              <button
                type="button"
                onClick={onPublish}
                disabled={busy}
                data-testid="employee-config-publish"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary hover:bg-primary-hover text-primary-fg text-[12px] font-medium shadow-soft-sm hover:-translate-y-px transition duration-base disabled:opacity-40"
              >
                {busyAction === "publish" ? (
                  <>
                    <Icon name="loader" size={12} className="animate-spin" />
                    {t("publishing")}
                  </>
                ) : (
                  <>
                    <Icon name="check-circle-2" size={12} strokeWidth={2} />
                    {t("publish")}
                  </>
                )}
              </button>
            )}
            {!isArchived && (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy || employee.is_lead_agent}
                title={
                  employee.is_lead_agent ? t("leadCannotDelete") : t("deleteHint")
                }
                data-testid="employee-config-delete"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-danger/40 bg-surface text-danger hover:bg-danger-soft text-[12px] font-medium shadow-soft-sm transition duration-base disabled:opacity-30 disabled:hover:bg-surface"
              >
                <Icon name="trash-2" size={12} strokeWidth={2} />
                {busyAction === "delete" ? t("deleting") : t("delete")}
              </button>
            )}
          </div>
        </div>
      </section>

      {skills === null || mcpServers === null ? (
        <LoadingState title={t("loadingForm")} />
      ) : (
        <DesignForm
          key={employee.id}
          skills={skills}
          mcpServers={mcpServers}
          initial={employee}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files tab · placeholder pending Phase 3
// ---------------------------------------------------------------------------

function FilesPane({ employeeName }: { employeeName: string }) {
  const t = useTranslations("employees.detail");
  return (
    <div data-testid="employee-tab-files">
      <div className="relative overflow-hidden rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(var(--color-border) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
        <div className="relative">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary-muted text-primary">
            <Icon name="folder" size={20} strokeWidth={2} />
          </div>
          <p className="text-[14px] text-text">
            {t("filesEmptyHeading", { name: employeeName })}
          </p>
          <p className="mt-1 text-[12px] text-text-muted">{t("filesEmptyBody")}</p>
          <Link
            href="/artifacts"
            className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition-colors duration-fast"
          >
            <Icon name="folder" size={12} />
            {t("filesGotoArtifacts")}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: "wand-2" | "file-code-2" | "message-square";
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="min-w-0 flex-1 flex items-start gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-muted text-primary shrink-0">
            <Icon name={icon} size={14} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-tight text-text">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-caption text-text-muted truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty / skeleton states
// ---------------------------------------------------------------------------

function ConversationsSkeleton() {
  return (
    <ul className="space-y-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
        >
          <div className="h-8 w-8 rounded-lg bg-surface-2 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-48 rounded bg-surface-2 animate-pulse" />
            <div className="h-2.5 w-32 rounded bg-surface-2 animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyConversations({ employeeName }: { employeeName: string }) {
  const t = useTranslations("employees.detail");
  return (
    <div className="relative overflow-hidden rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="relative">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary-muted text-primary">
          <Icon name="message-square" size={20} strokeWidth={2} />
        </div>
        <p className="text-[14px] text-text">
          {t("emptyConvosHeading", { name: employeeName })}
        </p>
        <p className="mt-1 text-[12px] text-text-muted">{t("emptyConvosBody")}</p>
      </div>
    </div>
  );
}
