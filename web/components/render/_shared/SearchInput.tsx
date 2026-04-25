"use client";

/**
 * SearchInput · compact filter input shared by viz components that hold
 * lists (Table, KV, Cards, Timeline). Renders an h-7 chip with a leading
 * search glyph and a clear button when non-empty.
 */

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Optional matched-count summary shown to the right of the input. */
  hint?: string;
  className?: string;
  /** Auto-focus the input on mount. */
  autoFocus?: boolean;
};

export function SearchInput({
  value,
  onChange,
  placeholder = "搜索…",
  hint,
  className,
  autoFocus,
}: Props) {
  return (
    <label
      className={cn(
        "group inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-caption font-mono text-text-muted transition-colors duration-fast focus-within:border-border-strong focus-within:text-text",
        className,
      )}
    >
      <Icon name="search" size={11} className="shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-32 min-w-0 bg-transparent outline-none placeholder:text-text-subtle"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="清空"
          className="inline-flex h-4 w-4 items-center justify-center rounded text-text-subtle hover:text-text-muted"
        >
          <Icon name="x" size={10} />
        </button>
      ) : null}
      {hint ? (
        <span className="ml-1 shrink-0 text-text-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Cheap case-insensitive substring matcher used by every search-enabled
 * viz component. Empty query → match everything.
 */
export function matchesQuery(text: unknown, query: string): boolean {
  if (!query) return true;
  if (text == null) return false;
  return String(text).toLowerCase().includes(query.trim().toLowerCase());
}
