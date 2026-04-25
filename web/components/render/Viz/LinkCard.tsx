"use client";

import type { RenderProps } from "@/lib/component-registry";
import { Icon } from "@/components/ui/icon";
import { CopyButton } from "@/components/render/_shared/CopyButton";

/**
 * Brand-Blue V2 (ADR 0016) · link card.
 *
 * Interactions (2026-04-25):
 *   - copy URL · hover-revealed CopyButton, doesn't trigger the outer
 *     anchor click (stopPropagation)
 *   - tile remains a real anchor for keyboard / accessibility
 */
export function LinkCard({ props }: RenderProps) {
  const url = typeof props.url === "string" && props.url ? props.url : "#";
  const title = typeof props.title === "string" ? props.title : "";
  const description =
    typeof props.description === "string" ? props.description : undefined;
  const favicon = typeof props.favicon === "string" ? props.favicon : undefined;
  const siteName = typeof props.siteName === "string" ? props.siteName : undefined;

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
      className="group relative block rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft animate-fade-up"
    >
      <div className="flex items-start gap-3">
        {favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={favicon}
            alt=""
            className="h-8 w-8 mt-0.5 rounded-md flex-shrink-0 border border-border bg-surface-2 object-contain p-0.5"
          />
        ) : (
          <span className="inline-flex h-8 w-8 mt-0.5 flex-shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-text-muted">
            <Icon name="link" size={14} />
          </span>
        )}
        <div className="flex-1 min-w-0 pr-12">
          <div className="text-sm font-semibold text-text truncate">{title}</div>
          {description && (
            <div className="mt-1 line-clamp-2 break-words text-caption leading-relaxed text-text-muted">
              {description}
            </div>
          )}
          <div className="mt-1.5 truncate font-mono text-caption text-text-subtle">
            {siteName ? `${siteName} · ${host}` : host}
          </div>
        </div>
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 right-3 text-text-muted"
      >
        <Icon name="external-link" size={14} />
      </span>
      {/* Copy URL · stopPropagation so the click doesn't navigate the anchor. */}
      <span
        className="absolute right-3 top-3 opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-within:opacity-100"
        onClick={(e) => e.preventDefault()}
      >
        <CopyButton value={url} label="复制链接" />
      </span>
    </a>
  );
}
