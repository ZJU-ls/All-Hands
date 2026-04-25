"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon, type IconName } from "@/components/ui/icon";

type ReviewGate = {
  id: string;
  titleKey: "selfReview" | "walkthroughAcceptance" | "harnessReview";
  icon: IconName;
  tone: "primary" | "accent" | "success";
  docs: { labelKey: "spec" | "artifacts" | "history"; href: string }[];
  meta_tool: string;
};

const GATES: ReviewGate[] = [
  {
    id: "self-review",
    titleKey: "selfReview",
    icon: "sparkles",
    tone: "primary",
    docs: [
      { labelKey: "spec", href: "/spec/2026-04-18-self-review" },
      { labelKey: "artifacts", href: "/review-artifacts" },
    ],
    meta_tool: "allhands.meta.cockpit.run_self_review",
  },
  {
    id: "walkthrough-acceptance",
    titleKey: "walkthroughAcceptance",
    icon: "eye",
    tone: "accent",
    docs: [
      { labelKey: "spec", href: "/spec/2026-04-18-walkthrough-acceptance" },
      { labelKey: "artifacts", href: "/acceptance" },
    ],
    meta_tool: "allhands.meta.cockpit.run_walkthrough_acceptance",
  },
  {
    id: "harness-review",
    titleKey: "harnessReview",
    icon: "shield-check",
    tone: "success",
    docs: [
      { labelKey: "spec", href: "/spec/2026-04-18-harness-review" },
      { labelKey: "history", href: "/harness-history" },
    ],
    meta_tool: "allhands.meta.cockpit.run_harness_review",
  },
];

export default function ReviewPage() {
  const t = useTranslations("pages.review");
  return (
    <AppShell title={t("title")}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-8 px-8 py-10 animate-fade-up">
          <PageHeader
            title={t("headerTitle")}
            subtitle={<>{t("headerSubtitle")}</>}
          />

          <div className="rounded-xl border border-primary/20 bg-primary-muted/60 p-4">
            <div className="flex items-start gap-2">
              <Icon name="info" size={14} className="mt-0.5 text-primary" />
              <p className="text-caption leading-relaxed text-text-muted">{t("orderNote")}</p>
            </div>
          </div>

          <ul className="space-y-4">
            {GATES.map((g) => (
              <GateCard key={g.id} gate={g} />
            ))}
          </ul>

          <footer className="space-y-2 rounded-xl border border-border bg-surface-2/40 p-5 font-mono text-caption text-text-muted">
            <div className="flex items-start gap-2">
              <Icon name="shield-check" size={12} className="mt-0.5 text-text-subtle" />
              <p>{t("footer.gateNote")}</p>
            </div>
            <div className="flex items-start gap-2">
              <Icon name="code" size={12} className="mt-0.5 text-text-subtle" />
              <p>
                {t("footer.lintRulesPrefix")}{" "}
                <code className="rounded bg-surface px-1.5 py-0.5 text-text">
                  ./scripts/review/lint-rules.sh
                </code>
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Icon name="file" size={12} className="mt-0.5 text-text-subtle" />
              <p>
                {t("footer.harnessAuditPrefix")}{" "}
                <code className="rounded bg-surface px-1.5 py-0.5 text-text">
                  ./scripts/harness/audit-docs.sh
                </code>
              </p>
            </div>
          </footer>
        </div>
      </div>
    </AppShell>
  );
}

function GateCard({ gate }: { gate: ReviewGate }) {
  const t = useTranslations("pages.review");
  const toneTile: Record<ReviewGate["tone"], string> = {
    primary: "bg-primary-muted text-primary",
    accent: "bg-accent/15 text-accent",
    success: "bg-success-soft text-success",
  };
  return (
    <li className="group relative overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-soft-sm transition duration-base hover:-translate-y-px hover:border-border-strong hover:shadow-soft">
      <div className="flex items-start gap-4">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${toneTile[gate.tone]}`}>
          <Icon name={gate.icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold tracking-tight text-text">
              {t(`gates.${gate.titleKey}.title`)}
            </h3>
            <span className="inline-flex items-center gap-1 font-mono text-caption text-text-subtle">
              <Icon name="clock" size={11} />
              {t(`gates.${gate.titleKey}.duration`)}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-4 gap-y-1.5 text-caption">
            <dt className="text-text-subtle">{t("fields.persona")}</dt>
            <dd className="text-text-muted">{t(`gates.${gate.titleKey}.persona`)}</dd>
            <dt className="text-text-subtle">{t("fields.rounds")}</dt>
            <dd className="text-text-muted">{t(`gates.${gate.titleKey}.rounds`)}</dd>
            <dt className="text-text-subtle">{t("fields.metaTool")}</dt>
            <dd>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text">
                {gate.meta_tool}
              </code>
            </dd>
          </dl>
          <div className="mt-3 flex items-center gap-4 pt-1 text-caption">
            {gate.docs.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="inline-flex items-center gap-1 font-medium text-text-muted hover:text-primary transition-colors duration-fast"
              >
                <Icon name="arrow-right" size={10} />
                {t(`docs.${d.labelKey}`)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}
