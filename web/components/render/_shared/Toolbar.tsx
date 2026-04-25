"use client";

/**
 * Toolbar · shared chrome for viz components that gain a header row of
 * interactions (sort toggle / view toggle / search). Renders a flex row
 * separated from the body by a hairline border.
 */

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

export function Toolbar({
  title,
  children,
  className,
}: {
  /** Optional left-side title — usually the chart's `title` prop. */
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border bg-surface-2/40 px-3 py-2",
        className,
      )}
    >
      {title ? (
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-text">
          {title}
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * ToolButton · small icon button used inside <Toolbar>. Active state
 * tints with primary; inactive is text-muted with hover lift.
 */
export function ToolButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  testId,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors duration-fast",
        active
          ? "border-primary/40 bg-primary-muted text-primary"
          : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text",
        disabled ? "cursor-not-allowed opacity-50" : "",
      )}
    >
      <Icon name={icon} size={12} />
    </button>
  );
}

/**
 * SegmentedControl · horizontal pill group for view-mode toggles
 * (split/unified · cozy/compact · etc.). Generic over the option key.
 */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<{ key: K; label: string; icon?: IconName }>;
  value: K;
  onChange: (next: K) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-surface p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded px-2 text-caption font-medium transition-colors duration-fast",
              active
                ? "bg-primary-muted text-primary"
                : "text-text-muted hover:text-text",
            )}
          >
            {o.icon ? <Icon name={o.icon} size={11} /> : null}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
