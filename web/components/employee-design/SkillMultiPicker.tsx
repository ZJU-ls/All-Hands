"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { HoverPeek } from "@/components/ui/HoverPeek";
import { cn } from "@/lib/cn";
import type { SkillDto } from "@/lib/api";

/**
 * SkillMultiPicker · upgraded 2026-04-26
 *
 * Why the rewrite: the original was a flat chip cloud — fine at 5 skills,
 * unusable at 30+. After installing the skills market this is realistic;
 * users couldn't find what they had just installed.
 *
 * New shape (Linear / GitHub Issues conventions):
 *
 *   ┌─ search box (M / N count) ──────────────────────────┐
 *   │ 🔍 搜索…                            12 / 35    [/] │
 *   ├─────────────────────────────────────────────────────┤
 *   │ ▼ 已选 · 4                                          │
 *   │   [✓ vector-search] [✓ web-fetch] [✓ pdf-reader]   │
 *   │   [✓ slack-notify]                                  │
 *   │ ▼ 内建 · 12                                         │
 *   │   [search] [...]                                    │
 *   │ ▼ 市场 · 18                                         │
 *   │   [chip] [...]                                      │
 *   │ ▼ GitHub · 1   ▼ 上传 · 0                           │
 *   └─────────────────────────────────────────────────────┘
 *
 * - Search filters by name AND description (case-insensitive)
 * - Already-selected items always surface in their own group up top so
 *   you can audit what's mounted at a glance, regardless of search
 * - Groups collapse independently; defaultOpen rules in `groupOrder` below
 * - "/" key from anywhere outside an input focuses the search field
 *
 * Hover peek (R4) is added on top of this in a follow-up commit.
 */
export function SkillMultiPicker({
  skills,
  selected,
  onToggle,
}: {
  skills: SkillDto[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("employees.skillPicker");
  const [query, setQuery] = useState("");

  const lcQuery = query.trim().toLowerCase();
  const matched = useMemo(() => {
    if (!lcQuery) return skills;
    return skills.filter((s) => {
      if (s.name.toLowerCase().includes(lcQuery)) return true;
      if (s.description.toLowerCase().includes(lcQuery)) return true;
      return false;
    });
  }, [skills, lcQuery]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Build grouped buckets from `matched`. "selected" group is special — it
  // shows ALL currently-mounted skills regardless of filter, so the user
  // never loses sight of what's already on the employee.
  const groups = useMemo(() => {
    const selectedSkills = skills.filter((s) => selectedSet.has(s.id));
    const bySource: Record<string, SkillDto[]> = {
      builtin: [],
      market: [],
      github: [],
      uploaded: [],
      other: [],
    };
    for (const s of matched) {
      const key = (s.source ?? "other").toLowerCase();
      const bucket =
        key === "builtin"
          ? "builtin"
          : key === "market"
            ? "market"
            : key === "github"
              ? "github"
              : key === "uploaded"
                ? "uploaded"
                : "other";
      bySource[bucket]?.push(s);
    }
    return {
      selected: selectedSkills,
      builtin: bySource.builtin ?? [],
      market: bySource.market ?? [],
      github: bySource.github ?? [],
      uploaded: bySource.uploaded ?? [],
      other: bySource.other ?? [],
    };
  }, [skills, matched, selectedSet]);

  if (skills.length === 0) {
    return <p className="text-[12px] text-text-muted">{t("empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t("searchPlaceholder")}
        count={matched.length}
        total={skills.length}
        compact
        autoFocusOnSlash
        testId="skill-picker-search"
      />
      {/* Selected always renders first, even when empty (so the user sees
          "0 已选" feedback after deselecting everything via search). */}
      <Group
        title={t("groupSelected")}
        count={groups.selected.length}
        items={groups.selected}
        selected={selectedSet}
        onToggle={onToggle}
        emptyHint={t("selectedEmpty")}
        defaultOpen
        tone="primary"
      />
      <Group
        title={t("groupBuiltin")}
        count={groups.builtin.length}
        items={groups.builtin}
        selected={selectedSet}
        onToggle={onToggle}
        defaultOpen
      />
      <Group
        title={t("groupMarket")}
        count={groups.market.length}
        items={groups.market}
        selected={selectedSet}
        onToggle={onToggle}
        defaultOpen
      />
      {groups.github.length > 0 && (
        <Group
          title={t("groupGithub")}
          count={groups.github.length}
          items={groups.github}
          selected={selectedSet}
          onToggle={onToggle}
        />
      )}
      {groups.uploaded.length > 0 && (
        <Group
          title={t("groupUploaded")}
          count={groups.uploaded.length}
          items={groups.uploaded}
          selected={selectedSet}
          onToggle={onToggle}
        />
      )}
      {groups.other.length > 0 && (
        <Group
          title={t("groupOther")}
          count={groups.other.length}
          items={groups.other}
          selected={selectedSet}
          onToggle={onToggle}
        />
      )}
      {/* No-match state — only show when filter is active and ALL non-
          selected groups are empty. Selected can still be non-empty. */}
      {lcQuery &&
        matched.length === 0 &&
        groups.selected.length === 0 && (
          <p
            data-testid="skill-picker-no-match"
            className="text-[12px] text-text-subtle italic px-1"
          >
            {t("noMatch", { query })}
          </p>
        )}
    </div>
  );
}

function Group({
  title,
  count,
  items,
  selected,
  onToggle,
  emptyHint,
  defaultOpen = false,
  tone = "neutral",
}: {
  title: string;
  count: number;
  items: SkillDto[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyHint?: string;
  defaultOpen?: boolean;
  tone?: "neutral" | "primary";
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Auto-open when filter narrows results to small numbers — saves a click
  // when user types something specific.
  const effectiveOpen = open || count > 0 && count <= 6;
  if (count === 0 && !emptyHint) return null;
  return (
    <section className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={effectiveOpen}
        className="w-full flex items-center gap-2 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
      >
        <Icon
          name="chevron-down"
          size={11}
          className={cn(
            "text-text-subtle transition-transform duration-fast",
            effectiveOpen ? "" : "-rotate-90",
          )}
        />
        <span
          className={cn(
            "text-[10.5px] uppercase tracking-[0.08em] font-mono group-hover:text-text-muted transition-colors",
            tone === "primary" ? "text-primary" : "text-text-subtle",
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            "font-mono text-[10.5px] tabular-nums",
            tone === "primary" && count > 0
              ? "text-primary"
              : "text-text-subtle",
          )}
        >
          · {count}
        </span>
        <span aria-hidden className="flex-1 h-px bg-border" />
      </button>
      {effectiveOpen && (
        <ul className="flex flex-wrap gap-1.5 pl-4">
          {count === 0 && emptyHint && (
            <li className="text-[11px] text-text-subtle italic px-1.5 py-1">
              {emptyHint}
            </li>
          )}
          {items.map((s) => {
            const on = selected.has(s.id);
            return (
              <li key={s.id}>
                <SkillChip skill={s} on={on} onToggle={() => onToggle(s.id)} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SkillChip({
  skill,
  on,
  onToggle,
}: {
  skill: SkillDto;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <HoverPeek content={<SkillPeekContent skill={skill} on={on} />}>
      <button
        type="button"
        data-testid={`skill-${skill.id}`}
        aria-pressed={on}
        onClick={onToggle}
        className={cn(
          "inline-flex max-w-[280px] items-center gap-1.5 rounded-md px-2.5 py-1 text-left transition-colors duration-fast",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          on
            ? "bg-primary-muted text-primary border border-primary/30"
            : "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text border border-transparent",
        )}
      >
        <Icon
          name={on ? "check" : "sparkles"}
          size={12}
          className="shrink-0"
        />
        <span className="truncate text-[12px] font-medium">{skill.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-text-subtle">
          {skill.tool_ids.length}t
        </span>
      </button>
    </HoverPeek>
  );
}

function SkillPeekContent({ skill, on }: { skill: SkillDto; on: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-text truncate">
            {skill.name}
          </p>
          <p className="font-mono text-[10px] text-text-subtle">{skill.id}</p>
        </div>
        {on && (
          <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded bg-primary-muted text-primary font-mono text-[10px] shrink-0">
            <Icon name="check" size={10} />
            mounted
          </span>
        )}
      </div>
      {skill.description && (
        <p className="text-[12px] leading-relaxed text-text-muted">
          {skill.description}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-mono text-text-subtle">
        {skill.source && (
          <span className="inline-flex items-center gap-1 px-1.5 h-4 rounded bg-surface-2">
            {skill.source}
          </span>
        )}
        {skill.version && (
          <span className="inline-flex items-center gap-1 px-1.5 h-4 rounded bg-surface-2">
            v{skill.version}
          </span>
        )}
        <span className="inline-flex items-center gap-1 px-1.5 h-4 rounded bg-surface-2">
          {skill.tool_ids.length} tools
        </span>
      </div>
      {skill.tool_ids.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[10.5px] font-mono text-text-subtle hover:text-text-muted">
            <Icon
              name="chevron-down"
              size={10}
              className="inline-block -mt-0.5 mr-0.5 transition-transform group-open:rotate-0 -rotate-90"
            />
            tool_ids
          </summary>
          <ul className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto pl-2">
            {skill.tool_ids.map((tid) => (
              <li
                key={tid}
                className="font-mono text-[10.5px] text-text-muted truncate"
              >
                {tid}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
