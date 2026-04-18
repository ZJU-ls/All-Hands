"use client";

import type { RenderProps } from "@/lib/component-registry";

export function LinkCard({ props }: RenderProps) {
  const url = (props.url as string | undefined) ?? "#";
  const title = (props.title as string | undefined) ?? "";
  const description = props.description as string | undefined;
  const favicon = props.favicon as string | undefined;
  const siteName = props.siteName as string | undefined;

  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-border bg-bg p-3 transition-colors hover:border-text-muted"
    >
      <div className="flex items-start gap-3">
        {favicon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={favicon}
            alt=""
            className="h-6 w-6 mt-0.5 rounded-sm flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text truncate">{title}</div>
          {description && (
            <div className="text-xs text-text-muted mt-0.5 leading-relaxed line-clamp-2">
              {description}
            </div>
          )}
          <div className="text-xs text-text-subtle font-mono mt-1.5 truncate">
            {siteName ? `${siteName} · ${host}` : host}
          </div>
        </div>
        <span className="text-xs text-text-muted font-mono mt-0.5" aria-hidden>
          ↗
        </span>
      </div>
    </a>
  );
}
