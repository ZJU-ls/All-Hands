"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { Icon } from "@/components/ui/icon";
import { DesignForm } from "@/components/employee-design/DesignForm";
import {
  listMcpServers,
  listSkills,
  type EmployeeDto,
  type McpServerDto,
  type SkillDto,
} from "@/lib/api";

/**
 * /employees/new · Hire-a-new-employee surface.
 *
 * Replaces the "left-rail roster + right-form" composite of the old
 * /employees/design page: this URL is dedicated to creating one new employee.
 * After save we jump straight to the new employee's detail page, where the
 * Config tab takes over for further edits / publish / delete.
 */
export default function NewEmployeePage() {
  const t = useTranslations("employees.new");
  const router = useRouter();
  const [skills, setSkills] = useState<SkillDto[] | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerDto[] | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [sk, mcp] = await Promise.all([
          listSkills().catch(() => [] as SkillDto[]),
          listMcpServers().catch(() => [] as McpServerDto[]),
        ]);
        if (cancelled) return;
        setSkills(sk);
        setMcpServers(mcp);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = skills !== null && mcpServers !== null;

  function handleCreated(emp: EmployeeDto) {
    router.push(`/employees/${emp.id}?tab=config`);
  }

  return (
    <AppShell
      title={t("shellTitle")}
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
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          <header className="space-y-2">
            <p className="font-mono text-caption uppercase tracking-wider text-text-subtle">
              {t("eyebrow")}
            </p>
            <h1 className="text-[22px] font-semibold tracking-tight text-text">
              {t("heading")}
            </h1>
            <p className="text-[13px] text-text-muted leading-relaxed max-w-2xl">
              {t("subtitle")}
            </p>
          </header>

          {error && (
            <div
              data-testid="employee-new-error"
              className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger"
            >
              <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words font-mono">{error}</span>
            </div>
          )}

          {!ready ? (
            <LoadingState title={t("loadingForm")} />
          ) : (
            <DesignForm
              skills={skills}
              mcpServers={mcpServers}
              onCreated={handleCreated}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
