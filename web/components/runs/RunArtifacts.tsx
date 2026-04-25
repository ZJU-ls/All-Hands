"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { ArtifactSummaryDto } from "@/lib/observatory-api";

const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  markdown: { label: "MD", cls: "bg-primary-muted text-primary" },
  code: { label: "PY", cls: "bg-accent/15 text-accent" },
  html: { label: "HTML", cls: "bg-primary-muted text-primary" },
  image: { label: "IMG", cls: "bg-warning-soft text-warning" },
  data: { label: "JSON", cls: "bg-surface-2 text-text-muted" },
  mermaid: { label: "MMD", cls: "bg-success-soft text-success" },
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

export function RunArtifacts({ artifacts }: { artifacts: ArtifactSummaryDto[] }) {
  const t = useTranslations("runs.artifacts");
  if (!artifacts || artifacts.length === 0) return null;

  return (
    <section
      data-testid="run-artifacts"
      className="rounded-xl border border-success/20 bg-success-soft/30 p-3"
    >
      <header className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider font-semibold text-success">
          {t("title", { count: artifacts.length })}
        </span>
        <span className="ml-auto text-[11px] text-text-subtle">{t("subtitle")}</span>
      </header>
      <ul className="space-y-1.5">
        {artifacts.map((a) => {
          const badge = KIND_BADGE[a.kind] ?? {
            label: a.kind.slice(0, 3).toUpperCase(),
            cls: "bg-surface-2 text-text-muted",
          };
          return (
            <li key={a.id}>
              <Link
                href={`/artifacts/${a.id}`}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 transition-colors duration-fast hover:border-border-strong hover:bg-surface-2/40"
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded font-mono text-[9px] font-bold ${badge.cls}`}
                >
                  {badge.label}
                </span>
                <span className="truncate text-[12.5px] text-text">{a.name}</span>
                <span className="shrink-0 text-[11px] text-text-subtle">
                  · {a.kind} · {formatBytes(a.size_bytes)} · {t("version", { version: a.version })}
                  {a.version === 1 ? ` · ${t("new")}` : ""}
                </span>
                <Icon
                  name="arrow-right"
                  size={12}
                  className="ml-auto shrink-0 text-text-subtle"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
