"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { Icon } from "@/components/ui/icon";
import {
  getEmployee,
  listConversations,
  createConversation,
  type ConversationDto,
  type EmployeeDto,
} from "@/lib/api";
import { deriveProfile } from "@/lib/employee-profile";

/**
 * Employee detail · single-employee dashboard (ADR 0016 · V2 Azure Live).
 *
 * Hero card (gradient primary · avatar · pill badges · action cluster) lands
 * the user; a KPI meta-strip summarises volume and latency; read-only skill
 * chip row + system-prompt preview explain the composition; recent
 * conversations list gives a direct jump back into the chat.
 *
 * Data / mutation contract unchanged: parallel fetch of employee + its
 * conversations, createConversation → push to /chat/:id.
 */

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
  const t = useTranslations("employees.detail");
  const badgeT = useTranslations("employeeBadges");
  const { employeeId } = useParams<{ employeeId: string }>();
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeDto | null>(null);
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [e, c] = await Promise.all([
          getEmployee(employeeId),
          listConversations({ employeeId }),
        ]);
        if (cancelled) return;
        setEmployee(e);
        setConversations(c);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

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
              <HeroCard
                employee={employee}
                isLead={isLead}
                creating={creating}
                onNewConversation={() => void handleNewConversation()}
              />

              <MetaStrip
                employee={employee}
                conversationCount={conversations?.length ?? 0}
              />

              <Section
                title={t("skillsTitle")}
                subtitle={t("skillsSubtitle", { count: employee.skill_ids.length })}
                icon="wand-2"
              >
                {employee.skill_ids.length === 0 ? (
                  <p className="text-[12px] text-text-subtle italic">
                    {t("skillsEmpty")}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {employee.skill_ids.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-primary-muted text-primary text-caption font-mono font-medium"
                      >
                        <Icon name="sparkles" size={10} strokeWidth={2} />
                        {id.replace(/^allhands\.(skills|builtin)\./, "")}
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
                  <p className="text-[12px] text-text-subtle italic">
                    {t("promptEmpty")}
                  </p>
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
                    onClick={() => void handleNewConversation()}
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
                            <p className="mt-0.5 font-mono text-caption text-text-subtle truncate">
                              {c.id.slice(0, 8)} ·{" "}
                              {new Date(c.created_at).toLocaleString()}
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
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
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
}: {
  employee: EmployeeDto;
  isLead: boolean;
  creating: boolean;
  onNewConversation: () => void;
}) {
  const t = useTranslations("employees.detail");
  return (
    <section
      data-testid="employee-hero"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-surface to-surface border border-primary/20 shadow-soft-lg p-6"
    >
      {/* Decorative orb */}
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
              className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-caption font-mono font-semibold uppercase tracking-wider ${
                employee.status === "draft"
                  ? "bg-warning-soft text-warning"
                  : "bg-success-soft text-success"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  employee.status === "draft" ? "bg-warning" : "bg-success"
                }`}
              />
              {employee.status === "draft" ? t("statusDraft") : t("statusPublished")}
            </span>
          </div>
          {employee.description ? (
            <p className="mt-2 text-[13px] text-text-muted leading-relaxed max-w-2xl">
              {employee.description}
            </p>
          ) : (
            <p className="mt-2 text-[13px] text-text-subtle italic">{t("noDescription")}</p>
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
          <Link
            href={`/employees/design`}
            data-testid="employee-hero-edit"
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-border bg-surface text-[13px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
          >
            <Icon name="edit" size={14} />
            {t("edit")}
          </Link>
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
              <p className="mt-0.5 text-caption text-text-muted truncate">
                {subtitle}
              </p>
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
        <p className="mt-1 text-[12px] text-text-muted">
          {t("emptyConvosBody")}
        </p>
      </div>
    </div>
  );
}
