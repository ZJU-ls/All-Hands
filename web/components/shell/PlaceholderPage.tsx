"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "./AppShell";

export function PlaceholderPage({
  title,
  description,
  note,
}: {
  title: string;
  description: string;
  note?: string;
}) {
  const t = useTranslations("shellExtras.placeholder");
  return (
    <AppShell title={title}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-10">
          <h2 className="text-xl font-semibold text-text mb-2">{title}</h2>
          <p className="text-sm text-text-muted mb-6">{description}</p>
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-text-subtle text-sm">
              {note ?? t("defaultNote")}
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
