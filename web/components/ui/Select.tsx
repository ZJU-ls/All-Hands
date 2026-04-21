"use client";

/**
 * Select — allhands-native dropdown primitive (replaces native <select>).
 *
 * Why: the browser-chrome native <select> bursts through our visual contract
 * (non-token border, OS-default chevron, system popover chrome that can't be
 * themed). This component renders the same semantics — single selection over
 * a flat or grouped option list — but inside our own DOM so Linear Precise
 * tokens apply end-to-end.
 *
 * Contract (see product/03-visual-design.md §3.8):
 *   - token-only colours (bg-surface / border / text-*)
 *   - no third-party popover library; absolute-positioned panel, no portal
 *   - animation limited to ah-fade-up on open
 *   - no hover:scale, no hover:shadow — hover only shifts border opacity
 *
 * ARIA: trigger carries role="combobox"; panel role="listbox"; options
 * role="option" with aria-selected. Groups render role="group" with a
 * visually styled label row that is aria-labelledby'd by the options below.
 *
 * Keyboard:
 *   Closed trigger  — Enter/Space/↓/↑ open, with ↓/↑ moving highlight.
 *   Open            — ↓/↑ move, Home/End jump, Enter selects, Esc closes,
 *                     Tab closes without selecting (focus flows naturally).
 *
 * Scope: this file owns the trigger + listbox. Consumers that already have
 * their own popover (e.g. ModelOverrideChip) can still embed it — the panel
 * lives in the same DOM subtree as the trigger, so outer click-outside
 * handlers will see the nested options as "inside".
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDownIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import {
  computePopoverSide,
  type PopoverSide,
} from "@/lib/popover-placement";

export type SelectOption = {
  value: string;
  label: string;
  /** Right-aligned mono hint (e.g. "默认" / "deprecated"). */
  hint?: string;
  disabled?: boolean;
  /** Passes through to the rendered `<li>` for e2e hooks. */
  testId?: string;
};

export type SelectGroup = {
  id: string;
  label: string;
  options: SelectOption[];
};

type SharedProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** `md` = 36px trigger (default, matches form controls). `sm` = 28px (chip). */
  size?: "sm" | "md";
  /** Align panel to left or right of trigger. Default "left". */
  popoverAlign?: "left" | "right";
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  testId?: string;
  /** Custom renderer for the trigger label; receives the selected option or null. */
  renderTrigger?: (selected: SelectOption | null) => React.ReactNode;
  /** Max height of the listbox panel (px). Default 280. */
  maxHeight?: number;
};

type FlatProps = SharedProps & { options: SelectOption[]; groups?: never };
type GroupProps = SharedProps & { groups: SelectGroup[]; options?: never };

export type SelectProps = FlatProps | GroupProps;

function flatten(props: SelectProps): SelectOption[] {
  if ("groups" in props && props.groups) {
    return props.groups.flatMap((g) => g.options);
  }
  return props.options ?? [];
}

function findOption(props: SelectProps, value: string): SelectOption | null {
  for (const o of flatten(props)) {
    if (o.value === value) return o;
  }
  return null;
}

function nextEnabledIndex(
  options: SelectOption[],
  from: number,
  dir: 1 | -1,
): number {
  if (options.length === 0) return -1;
  let i = from;
  for (let step = 0; step < options.length; step += 1) {
    i = (i + dir + options.length) % options.length;
    if (!options[i]!.disabled) return i;
  }
  return -1;
}

export function Select(props: SelectProps) {
  const {
    value,
    onChange,
    placeholder = "选择…",
    disabled = false,
    size = "md",
    popoverAlign = "left",
    className,
    triggerClassName,
    ariaLabel,
    testId,
    renderTrigger,
    maxHeight = 280,
  } = props;

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [side, setSide] = useState<PopoverSide>("bottom");
  const [panelMaxHeight, setPanelMaxHeight] = useState(maxHeight);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listboxId = useId();
  const optionBaseId = useId();

  const flatOptions = useMemo(() => flatten(props), [props]);
  const selected = findOption(props, value);

  // Keep highlight in sync when opening — prefer current selected, else first.
  useLayoutEffect(() => {
    if (!open) return;
    if (value) {
      const idx = flatOptions.findIndex((o) => o.value === value);
      setHighlight(idx >= 0 ? idx : nextEnabledIndex(flatOptions, -1, 1));
    } else {
      setHighlight(nextEnabledIndex(flatOptions, -1, 1));
    }
  }, [open, value, flatOptions]);

  // Flip placement on open based on viewport room. Prefer bottom; fall back to
  // top when cramped. Also clamp panel height to what actually fits on the
  // chosen side so the list never bleeds off-screen (user L09 bug).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const picked = computePopoverSide(rect, maxHeight, vh, "bottom");
    setSide(picked);
    // Leave an 8px cushion to the viewport edge — keeps the panel from
    // kissing the boundary, matches our base 4/8/12 spacing rhythm.
    const GUTTER = 8;
    const avail =
      picked === "bottom" ? vh - rect.bottom - GUTTER : rect.top - GUTTER;
    setPanelMaxHeight(Math.max(120, Math.min(maxHeight, avail)));
  }, [open, maxHeight]);

  // Scroll the highlighted option into view as the user arrows through the
  // list — essential for long model lists that overflow maxHeight.
  useEffect(() => {
    if (!open || highlight < 0 || !listRef.current) return;
    const opt = listRef.current.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    // scrollIntoView is not in every environment (jsdom lacks it); guard so
    // unit tests don't crash while real browsers get the side effect.
    opt?.scrollIntoView?.({ block: "nearest" });
  }, [open, highlight]);

  // Click-outside + Escape-on-document while open. Defined inside an effect so
  // we tear down cleanly when the panel closes.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(ev: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(ev.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const pick = useCallback(
    (opt: SelectOption) => {
      if (opt.disabled) return;
      onChange(opt.value);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const onTriggerKey = useCallback(
    (ev: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (!open) {
        if (ev.key === "Enter" || ev.key === " " || ev.key === "ArrowDown") {
          ev.preventDefault();
          setOpen(true);
        } else if (ev.key === "ArrowUp") {
          ev.preventDefault();
          setOpen(true);
        }
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        setOpen(false);
        return;
      }
      if (ev.key === "Tab") {
        setOpen(false);
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        setHighlight((h) => nextEnabledIndex(flatOptions, h, 1));
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        setHighlight((h) => nextEnabledIndex(flatOptions, h, -1));
        return;
      }
      if (ev.key === "Home") {
        ev.preventDefault();
        setHighlight(nextEnabledIndex(flatOptions, -1, 1));
        return;
      }
      if (ev.key === "End") {
        ev.preventDefault();
        setHighlight(nextEnabledIndex(flatOptions, 0, -1));
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        const opt = flatOptions[highlight];
        if (opt) pick(opt);
        return;
      }
    },
    [disabled, open, flatOptions, highlight, pick],
  );

  const triggerLabel = renderTrigger
    ? renderTrigger(selected)
    : selected
      ? (
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="truncate">{selected.label}</span>
            {selected.hint && (
              <span className="font-mono text-[10px] text-text-subtle">
                {selected.hint}
              </span>
            )}
          </span>
        )
      : (
          <span className="text-text-subtle">{placeholder}</span>
        );

  const sizeClasses =
    size === "sm"
      ? "h-7 px-2 text-[11px]"
      : "h-9 px-3 text-[12px]";
  const disabledClasses = disabled ? "opacity-60 cursor-not-allowed" : "";
  const openBorder = open ? "border-border-strong" : "border-border";

  const renderOption = (opt: SelectOption, flatIdx: number) => {
    const isSelected = opt.value === value;
    const isHighlighted = flatIdx === highlight;
    return (
      <li
        key={opt.value}
        role="option"
        id={`${optionBaseId}-${flatIdx}`}
        data-index={flatIdx}
        data-testid={opt.testId}
        aria-selected={isSelected}
        aria-disabled={opt.disabled || undefined}
        onMouseEnter={() => setHighlight(flatIdx)}
        onMouseDown={(ev) => {
          // Mousedown (not click) so we fire before the outer document-
          // mousedown click-outside handler has a chance to close the panel.
          ev.preventDefault();
          pick(opt);
        }}
        className={cn(
          "relative flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-[12px] transition-colors duration-base",
          opt.disabled
            ? "cursor-not-allowed text-text-subtle"
            : isHighlighted
              ? "bg-surface-2 text-text"
              : "text-text-muted hover:text-text",
        )}
      >
        {isSelected && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
          />
        )}
        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
        {opt.hint && (
          <span className="font-mono text-[10px] text-text-subtle">
            {opt.hint}
          </span>
        )}
      </li>
    );
  };

  const panelAlign = popoverAlign === "right" ? "right-0" : "left-0";

  // Precompute the starting flat index for each group so options share a
  // single numbering used by highlight + aria-activedescendant.
  let runningIdx = 0;
  const groups = "groups" in props && props.groups ? props.groups : null;

  return (
    <div
      ref={rootRef}
      className={cn("relative inline-block", className)}
    >
      <button
        type="button"
        ref={triggerRef}
        data-testid={testId}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && highlight >= 0 ? `${optionBaseId}-${highlight}` : undefined
        }
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKey}
        className={cn(
          "inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-surface text-text transition-colors duration-base hover:border-border-strong focus:outline-none focus:border-border-strong",
          sizeClasses,
          openBorder,
          disabledClasses,
          triggerClassName,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
        <ChevronDownIcon
          size={size === "sm" ? 12 : 14}
          className={cn(
            "shrink-0 text-text-subtle transition-colors duration-base",
            open ? "text-text-muted" : "",
          )}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          data-side={side}
          className={cn(
            "absolute z-30 min-w-full overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg",
            panelAlign,
            side === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
          )}
          style={{
            maxHeight: panelMaxHeight,
            animation: "ah-fade-up 160ms var(--ease-out, ease-out) both",
          }}
        >
          {groups
            ? groups.map((g) => {
                const header = (
                  <li
                    key={`${g.id}-hdr`}
                    role="presentation"
                    className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-text-subtle"
                  >
                    {g.label}
                  </li>
                );
                const items = g.options.map((opt) => {
                  const el = renderOption(opt, runningIdx);
                  runningIdx += 1;
                  return el;
                });
                return (
                  <li
                    key={g.id}
                    role="group"
                    aria-label={g.label}
                    className="list-none"
                  >
                    <ul className="list-none p-0">
                      {header}
                      {items}
                    </ul>
                  </li>
                );
              })
            : (props.options ?? []).map((opt, idx) => renderOption(opt, idx))}
          {flatOptions.length === 0 && (
            <li
              role="presentation"
              className="px-3 py-3 text-center text-[12px] text-text-subtle"
            >
              没有可选项
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
