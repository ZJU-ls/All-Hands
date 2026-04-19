"use client";

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
  return (
    <AppShell title={title}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-10">
          <h2 className="text-xl font-semibold text-text mb-2">{title}</h2>
          <p className="text-sm text-text-muted mb-6">{description}</p>
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-text-subtle text-sm">
              {note ?? "此模块正在建设中。未来通过与 Lead Agent 对话或本页面进行管理。"}
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
