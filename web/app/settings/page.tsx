"use client";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon, type IconName } from "@/components/ui/icon";
import { LocaleSwitcher } from "@/components/locale/LocaleSwitcher";
import { AutoTitleToggle } from "@/components/settings/AutoTitleToggle";
import { StoragePathsCard } from "@/components/settings/StoragePathsCard";
import Link from "next/link";

type CardKey = "providers" | "models" | "mcp" | "notifications" | "workspaces";
const CARD_DEFS: { key: CardKey; icon: IconName; href: string }[] = [
  { key: "providers", icon: "server", href: "/gateway/providers" },
  { key: "models", icon: "brain", href: "/gateway/models" },
  { key: "mcp", icon: "plug", href: "/mcp-servers" },
  { key: "notifications", icon: "bell", href: "/channels" },
  { key: "workspaces", icon: "folder", href: "/settings/workspaces" },
];

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tCards = useTranslations("settings.cards");
  return (
    <AppShell title={t("title")}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-8 px-8 py-10 animate-fade-up">
          <PageHeader title={t("title")} subtitle={t("subtitle")} />

          <section className="rounded-xl border border-border bg-surface p-5 shadow-soft-sm">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary">
                <Icon name="languages" size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold tracking-tight text-text">
                  {t("language")}
                </h3>
                <p className="mt-1 text-caption leading-relaxed text-text-muted">
                  {t("languageDescription")}
                </p>
                <div className="mt-4 max-w-sm">
                  <LocaleSwitcher mode="full" />
                </div>
              </div>
            </div>
          </section>

          <AutoTitleToggle />

          <StoragePathsCard />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {CARD_DEFS.map((c) => (
              <SettingsCard
                key={c.key}
                icon={c.icon}
                title={tCards(`${c.key}.title`)}
                description={tCards(`${c.key}.description`)}
                href={c.href}
                ctaLabel={tCards(`${c.key}.cta`)}
              />
            ))}
          </div>

          <div className="rounded-xl border border-border bg-surface-2/40 p-5 text-caption text-text-muted">
            <div className="flex items-start gap-2">
              <Icon name="info" size={14} className="mt-0.5 text-text-subtle" />
              <div>{t("footnote")}</div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SettingsCard({
  icon,
  title,
  description,
  href,
  ctaLabel,
}: {
  icon: IconName;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
}) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-soft-sm transition duration-base hover:-translate-y-px hover:border-border-strong hover:shadow-soft"
    >
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary">
          <Icon name={icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold tracking-tight text-text">{title}</h3>
          <p className="mt-1 text-caption leading-relaxed text-text-muted">{description}</p>
        </div>
        <Icon
          name="arrow-right"
          size={14}
          className="mt-1 shrink-0 self-start text-text-subtle opacity-0 transition-[opacity,transform] duration-fast group-hover:translate-x-0.5 group-hover:opacity-100 group-hover:text-primary"
        />
      </div>
      <div className="mt-4 border-t border-border/60 pt-3 text-caption font-medium text-primary">
        {ctaLabel} →
      </div>
    </Link>
  );
}
