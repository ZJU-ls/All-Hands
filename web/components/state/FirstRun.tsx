"use client";

/**
 * FirstRun · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Hero-style welcome card: mesh-hero backdrop, gradient primary-to-accent
 * icon tile, display-size title, optional subtitle, 3-step checklist with
 * check-circle for done items, primary gradient CTA + optional secondary
 * (skip / later).
 *
 * Preserves public API: { title, description?, steps, primaryAction?, secondaryAction? }.
 */

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";

export type FirstRunStep = {
  title: string;
  description?: string;
  done?: boolean;
};

export function FirstRun({
  title,
  description,
  steps,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  description?: string;
  steps: FirstRunStep[];
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}) {
  const t = useTranslations("state.firstRun");
  return (
    <section
      role="region"
      aria-label={t("ariaLabel")}
      data-state="first-run"
      className="relative overflow-hidden rounded-2xl border border-border bg-surface px-8 py-8 shadow-soft-lg"
    >
      {/* mesh-hero backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(520px 280px at 15% 10%, var(--color-primary-muted), transparent 65%)," +
            "radial-gradient(420px 260px at 90% 80%, color-mix(in srgb, var(--color-accent) 24%, transparent), transparent 65%)",
        }}
      />
      {/* hairline top accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
      />

      <div className="relative">
        <div className="flex items-start gap-4">
          <div
            aria-hidden="true"
            className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-fg shadow-soft-lg animate-float"
          >
            <Icon name="sparkles" size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-caption uppercase tracking-wider text-text-subtle">
              {t("eyebrow")}
            </div>
            <h2 className="mt-1 text-xl font-bold tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {title}
            </h2>
            {description && (
              <p className="mt-2 text-sm text-text-muted">{description}</p>
            )}
          </div>
        </div>

        <ol className="mt-6 space-y-2.5">
          {steps.map((step, i) => (
            <li
              key={`${i}-${step.title}`}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface/70 px-3 py-2.5"
            >
              <span
                aria-hidden="true"
                className={
                  step.done
                    ? "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-success-soft text-success"
                    : "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-muted font-mono text-caption font-semibold text-primary"
                }
              >
                {step.done ? <Icon name="check" size={13} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text">{step.title}</p>
                {step.description && (
                  <p className="mt-0.5 text-caption text-text-muted">
                    {step.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>

        {(primaryAction || secondaryAction) && (
          <div className="mt-7 flex items-center gap-3">
            {primaryAction && (
              <button
                type="button"
                onClick={primaryAction.onClick}
                className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-primary to-accent px-5 py-2.5 text-sm font-semibold text-primary-fg shadow-soft-sm transition-colors duration-base hover:-translate-y-px hover:shadow-soft"
              >
                {primaryAction.label}
                <Icon name="arrow-right" size={14} />
              </button>
            )}
            {secondaryAction && (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-text-muted transition-colors duration-base hover:border-border-strong hover:text-text hover:bg-surface-2"
              >
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
