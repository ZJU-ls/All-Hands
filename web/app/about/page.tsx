"use client";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/ui/icon";

export default function AboutPage() {
  const t = useTranslations("pages.about");
  return (
    <AppShell title={t("title")}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-12 animate-fade-up">
          {/* Hero card */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-10 shadow-soft-sm">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{
                background:
                  "radial-gradient(600px 300px at 20% 0%, var(--color-primary-soft) 0%, transparent 60%), radial-gradient(500px 300px at 80% 100%, var(--color-accent) 0%, transparent 65%)",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, var(--color-border) 1px, transparent 0)",
                backgroundSize: "24px 24px",
                opacity: 0.3,
              }}
            />
            <div className="relative">
              <div
                className="grid h-14 w-14 place-items-center rounded-2xl text-primary-fg shadow-soft-lg"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
                }}
              >
                <Icon name="sparkles" size={26} />
              </div>
              <h1 className="mt-6 text-[36px] font-bold leading-tight tracking-tight">
                <span
                  className="bg-gradient-to-r from-primary via-accent to-primary-glow bg-clip-text text-transparent"
                >
                  allhands
                </span>
              </h1>
              <p className="mt-3 text-base text-text">
                {t("tagline")}
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
                {t("description")}
              </p>
              <div className="mt-6 inline-flex h-6 items-center gap-2 rounded-full border border-border bg-surface px-2.5 shadow-soft-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span className="font-mono text-caption text-text-muted uppercase tracking-wider">
                  {t("version")}
                </span>
              </div>
            </div>
          </div>

          {/* Quick facts grid */}
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Fact
              icon="layout-grid"
              label={t("facts.principles.label")}
              body={t("facts.principles.body")}
            />
            <Fact
              icon="users"
              label={t("facts.employees.label")}
              body={t("facts.employees.body")}
            />
            <Fact
              icon="shield-check"
              label={t("facts.guardrails.label")}
              body={t("facts.guardrails.body")}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Fact({
  icon,
  label,
  body,
}: {
  icon: "layout-grid" | "users" | "shield-check";
  label: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:border-border-strong hover:shadow-soft hover:-translate-y-px">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary-muted text-primary">
        <Icon name={icon} size={16} />
      </div>
      <div className="mt-3 text-sm font-semibold tracking-tight text-text">{label}</div>
      <p className="mt-1 text-caption leading-relaxed text-text-muted">{body}</p>
    </div>
  );
}
