"use client";

/**
 * SearchInput · 共享列表搜索单件 (2026-04-26)
 *
 * 为什么单独抽出来:Skills / MCP / Skill picker / MCP picker / Tools 等多
 * 处都有"列表过滤搜索"需求,各自零散实现导致样式漂移、无统一键盘行为、
 * 一些页面甚至完全没有搜索框 — 用户在 30+ 项的列表里靠肉眼扫。
 *
 * 设计参照(业界最佳实践合集):
 *   - Linear:Cmd+K 即焦,搜索 chip 内出现命中 count
 *   - Raycast:即输入即过滤 + ↑↓ 键盘导航(此件只负责输入,导航由父级实现)
 *   - GitHub Issues:右侧显示"X / Y 显示中"明确告知过滤效果
 *   - Notion:占位符随上下文(skills / mcp / tools)变化,带 icon
 *   - Algolia:加载状态时左侧 icon 切 spinner
 *
 * Public API
 *   - value / onChange:受控文本
 *   - placeholder:占位符
 *   - count / total:右侧显示"M / N"过滤结果
 *   - shortcut:可选键盘快捷键标识(默认显示 "/")
 *   - loading:左 icon 切 spinner
 *   - autoFocusOnSlash:按 "/" 键自动聚焦此输入
 *   - testId
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Items currently visible after filter; if total > count, render "M / N". */
  count?: number;
  total?: number;
  /** Visual hint for the keyboard shortcut. Default `/`. Pass empty string to hide. */
  shortcut?: string;
  /** Render a spinner instead of the magnifier — useful while debouncing API calls. */
  loading?: boolean;
  /** Bind global "/" keypress to focus this field (good for primary lists). */
  autoFocusOnSlash?: boolean;
  /** When true, narrow density (h-8) — useful inside pickers. Default false (h-9). */
  compact?: boolean;
  className?: string;
  testId?: string;
  /** aria-label override; falls back to placeholder. */
  ariaLabel?: string;
};

export function SearchInput({
  value,
  onChange,
  placeholder,
  count,
  total,
  shortcut = "/",
  loading = false,
  autoFocusOnSlash = false,
  compact = false,
  className,
  testId,
  ariaLabel,
}: Props) {
  const t = useTranslations("ui.searchInput");
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedPlaceholder = placeholder ?? t("placeholder");

  useEffect(() => {
    if (!autoFocusOnSlash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoFocusOnSlash]);

  const showCount = typeof count === "number" && typeof total === "number";
  const isFiltered = showCount && count !== total;

  return (
    <div
      data-testid={testId ?? "search-input"}
      className={cn(
        "relative flex items-center rounded-md border border-border bg-surface transition-colors duration-fast",
        "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
        compact ? "h-8" : "h-9",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none flex w-8 shrink-0 items-center justify-center text-text-subtle"
      >
        {loading ? (
          <Icon name="loader" size={13} className="animate-spin" />
        ) : (
          <Icon name="search" size={13} />
        )}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={resolvedPlaceholder}
        aria-label={ariaLabel ?? resolvedPlaceholder}
        spellCheck={false}
        className={cn(
          "flex-1 min-w-0 bg-transparent text-[12.5px] text-text placeholder:text-text-subtle outline-none",
          compact ? "py-1" : "py-1.5",
        )}
      />
      {showCount && (
        <span
          data-testid="search-count"
          className={cn(
            "shrink-0 px-2 font-mono text-[10.5px] tabular-nums",
            isFiltered ? "text-primary" : "text-text-subtle",
          )}
        >
          {count} / {total}
        </span>
      )}
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("clear")}
          title={t("clear")}
          data-testid="search-clear"
          className="grid h-6 w-6 shrink-0 mr-1 place-items-center rounded text-text-subtle hover:text-text hover:bg-surface-2 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Icon name="x" size={11} />
        </button>
      )}
      {!value && shortcut && (
        <span
          aria-hidden="true"
          className="shrink-0 mr-2 grid h-5 min-w-5 place-items-center rounded border border-border bg-surface-2 px-1 font-mono text-[10px] text-text-subtle"
        >
          {shortcut}
        </span>
      )}
    </div>
  );
}
