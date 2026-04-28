"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import type { EmbeddingModelOption } from "@/lib/kb-api";

/**
 * OnboardingWizard — 4-step first-run guide shown when the user has zero KBs.
 * Lives at L1 (KB hub) since "no KB at all" only happens before any L2 page
 * is reachable.
 */
export function OnboardingWizard({
  models,
  onCreate,
}: {
  models: EmbeddingModelOption[];
  onCreate: () => void;
}) {
  const t = useTranslations("knowledge.onboarding");
  const realAvailable = models.filter(
    (m) => !m.ref.startsWith("mock:") && m.available,
  ).length;
  const steps = [
    {
      n: 1,
      title: t("step1Title"),
      done: realAvailable > 0,
      cta:
        realAvailable > 0
          ? t("step1Found", { count: realAvailable })
          : t("step1NotFound"),
      action:
        realAvailable === 0
          ? { href: "/gateway", label: t("step1Action") }
          : undefined,
      desc: t("step1Desc"),
    },
    {
      n: 2,
      title: t("step2Title"),
      done: false,
      cta: undefined,
      action: { onClick: onCreate, label: t("step2Action") },
      desc: t("step2Desc"),
    },
    {
      n: 3,
      title: t("step3Title"),
      done: false,
      cta: undefined,
      action: undefined,
      desc: t("step3Desc"),
    },
    {
      n: 4,
      title: t("step4Title"),
      done: false,
      cta: undefined,
      action: { href: "/employees", label: t("step4Action") },
      desc: t("step4Desc"),
    },
  ];
  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary-muted">
            <Icon name="book-open" size={26} className="text-primary" />
          </div>
          <h2 className="text-[20px] font-semibold text-text">
            {t("heading")}
          </h2>
          <p className="mt-1 text-[13px] text-text-muted">{t("subtitle")}</p>
        </div>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li
              key={s.n}
              className="flex gap-3 rounded-xl border border-border bg-surface-2 p-4"
            >
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg font-mono text-[12px] ${
                  s.done
                    ? "bg-success-soft text-success"
                    : "bg-primary-muted text-primary"
                }`}
              >
                {s.done ? <Icon name="check" size={14} /> : s.n}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
                  {s.title}
                  {s.cta && (
                    <span className="font-mono text-[10px] text-text-subtle">
                      · {s.cta}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
                  {s.desc}
                </p>
                {s.action && "href" in s.action ? (
                  <a
                    href={s.action.href}
                    className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
                  >
                    {s.action.label}
                    <Icon name="external-link" size={11} />
                  </a>
                ) : s.action ? (
                  <button
                    type="button"
                    onClick={s.action.onClick}
                    className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-fg hover:bg-primary-hover"
                  >
                    <Icon name="plus" size={11} />
                    {s.action.label}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-5 text-[13px] font-semibold text-primary-fg shadow-soft-sm hover:bg-primary-hover"
          >
            <Icon name="plus" size={14} />
            {t("primaryCta")}
          </button>
        </div>
      </div>
    </div>
  );
}
