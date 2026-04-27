"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/icon";
import { createConversation, listEmployees, type EmployeeDto } from "@/lib/api";
import { deriveProfile } from "@/lib/employee-profile";

/**
 * Employees · card grid view (ADR 0016 · V2 Azure Live polish).
 *
 * Rationale: users land here to scan "who's on my team" and jump into a
 * conversation. Rich cards (gradient avatar · status chip · model/skill chips
 * · stats row · sliding arrow) make the roster feel alive while preserving
 * Linear-descended density. The empty state gets a mesh-hero welcome block —
 * first impressions for a zero-employee workspace matter.
 *
 * Data / state / navigation contract is unchanged from the previous revision:
 * - `listEmployees({ status: "published" })` on mount.
 * - `createConversation(employeeId)` + router.push on click.
 * - `busyId` locks all cards while a conversation is being opened.
 */

function modelDisplay(modelRef: string, fallback: string): string {
  if (!modelRef) return fallback;
  const idx = modelRef.indexOf("/");
  return idx >= 0 ? modelRef.slice(idx + 1) : modelRef;
}

function avatarInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  // Pick up to two "word starts" — works for ASCII ("Sales Analyst" → SA) and
  // gracefully degrades to first two characters for CJK names.
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export default function EmployeesPage() {
  const t = useTranslations("employees.list");
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await listEmployees({ status: "published" });
        if (!cancelled) setEmployees(list);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
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

  return (
    <AppShell
      title={t("shellTitle")}
      actions={
        <Link
          href="/employees/new"
          data-testid="goto-employee-design"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
        >
          <Icon name="wand-2" size={14} />
          {t("designAction")}
        </Link>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 space-y-5 animate-fade-up">
          <PageHeader
            title={t("pageTitle")}
            count={employees?.length}
            subtitle={t("subtitle")}
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
          ) : employees.length === 0 ? (
            <EmptyEmployees />
          ) : (
            <div
              data-testid="employees-grid"
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
            >
              {employees.map((e) => (
                <EmployeeCard
                  key={e.id}
                  employee={e}
                  onStartChat={startChat}
                  busy={busyId === e.id}
                  anyBusy={busyId !== null}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function EmployeeCard({
  employee,
  onStartChat,
  busy,
  anyBusy,
}: {
  employee: EmployeeDto;
  onStartChat: (employeeId: string) => void;
  busy: boolean;
  anyBusy: boolean;
}) {
  const t = useTranslations("employees.list");
  const badgeT = useTranslations("employeeBadges");
  const badges = deriveProfile(employee).filter((b) => b !== "react");
  const isLead = employee.is_lead_agent;

  const cardClass = isLead
    ? "group relative flex flex-col gap-3 rounded-xl bg-gradient-to-br from-primary/10 via-surface to-surface border border-primary/40 shadow-soft-lg p-5 hover:-translate-y-px transition duration-base min-w-0"
    : "group relative flex flex-col gap-3 rounded-xl bg-surface border border-border shadow-soft-sm hover:shadow-soft hover:-translate-y-px hover:border-border-strong transition duration-base p-5 min-w-0";

  return (
    <div data-testid={`employee-card-${employee.name}`} className={cardClass}>
      {isLead && (
        <span
          className="absolute top-4 right-4 inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-primary text-primary-fg text-caption font-medium shadow-soft-sm"
          data-testid="badge-lead"
        >
          <Icon name="sparkles" size={10} />
          {t("leadBadge")}
        </span>
      )}

      <button
        type="button"
        onClick={() => onStartChat(employee.id)}
        disabled={anyBusy}
        aria-label={t("startChatAria", { name: employee.name })}
        data-testid={`employee-card-start-${employee.name}`}
        className="flex items-start gap-3 text-left disabled:opacity-60"
      >
        <div
          className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-primary-fg shadow-soft-sm shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          {avatarInitials(employee.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0 pr-16">
            <span className="text-[14px] font-semibold text-text truncate tracking-tight">
              {employee.name}
            </span>
          </div>
          <p className="font-mono text-[11px] text-text-subtle truncate mt-0.5">
            {modelDisplay(employee.model_ref, t("defaultModel")) || t("fallbackModel")}
          </p>
        </div>
      </button>

      {employee.description ? (
        <p className="text-[12px] text-text-muted leading-snug line-clamp-2 min-h-[32px]">
          {employee.description}
        </p>
      ) : (
        <p className="text-[12px] text-text-subtle italic leading-snug min-h-[32px]">
          {t("noDescription")}
        </p>
      )}

      {badges.length > 0 && (
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

      <div className="flex items-center gap-4 pt-3 mt-auto border-t border-border">
        <Stat icon="zap" label="tools" value={employee.tool_ids.length} />
        <Stat icon="wand-2" label="skills" value={employee.skill_ids.length} />
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/employees/${employee.id}`}
            data-testid={`employee-card-detail-${employee.name}`}
            className="inline-flex items-center h-7 px-2 rounded-md text-[11px] font-medium text-text-muted hover:text-text hover:bg-surface-2 transition duration-base"
          >
            {t("detail")}
          </Link>
          <button
            type="button"
            onClick={() => onStartChat(employee.id)}
            disabled={anyBusy}
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
                {t("chat")}
                <Icon
                  name="arrow-right"
                  size={12}
                  className="group-hover:translate-x-0.5 transition duration-base"
                />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
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

function EmptyEmployees() {
  const t = useTranslations("employees.list");
  return (
    <div
      data-testid="employees-empty"
      className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-sm"
    >
      {/* Mesh hero backdrop — soft primary / accent radial glows */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70 pointer-events-none"
        style={{
          background:
            "radial-gradient(600px 300px at 15% 20%, var(--color-primary-muted), transparent 60%), radial-gradient(500px 400px at 85% 60%, color-mix(in srgb, var(--color-accent, var(--color-primary)) 18%, transparent), transparent 60%)",
        }}
      />
      {/* Dotgrid backdrop over the mesh */}
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
