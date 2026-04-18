"use client";

import type { RenderProps } from "@/lib/component-registry";

type Kind = "info" | "warn" | "success" | "error";

const BAR_COLOR: Record<Kind, string> = {
  info: "bg-primary",
  warn: "bg-warning",
  success: "bg-success",
  error: "bg-danger",
};

const TITLE_COLOR: Record<Kind, string> = {
  info: "text-primary",
  warn: "text-warning",
  success: "text-success",
  error: "text-danger",
};

export function Callout({ props }: RenderProps) {
  const kind = ((props.kind as string) ?? "info") as Kind;
  const title = props.title as string | undefined;
  const content = (props.content as string | undefined) ?? "";

  return (
    <div className="relative rounded-lg border border-border bg-bg pl-4 pr-4 py-3">
      <span
        className={`absolute left-0 top-3 bottom-3 w-[2px] rounded-sm ${BAR_COLOR[kind]}`}
        aria-hidden
      />
      {title && (
        <div className={`text-xs font-semibold ${TITLE_COLOR[kind]} mb-1 uppercase tracking-wide`}>
          {title}
        </div>
      )}
      <div className="text-sm text-text leading-relaxed">{content}</div>
    </div>
  );
}
