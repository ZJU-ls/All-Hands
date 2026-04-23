"use client";

import { Icon } from "@/components/ui/icon";
import type { SkillDto } from "@/lib/api";

/**
 * V2 (ADR 0016): chip cloud. Selected chip = bg-primary-muted text-primary with
 * a check glyph + `N tools` mono tail; unselected = bg-surface-2 text-text-muted
 * hover:bg-surface-3. Description is truncated under the chip label.
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
  if (skills.length === 0) {
    return (
      <p className="text-[12px] text-text-muted">
        还没有安装的 Skill。先在「技能」页安装,再回来挂载。
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {skills.map((s) => {
        const on = selected.includes(s.id);
        return (
          <li key={s.id}>
            <button
              type="button"
              data-testid={`skill-${s.id}`}
              aria-pressed={on}
              onClick={() => onToggle(s.id)}
              title={s.description ?? undefined}
              className={
                "inline-flex max-w-[280px] items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors duration-fast " +
                (on
                  ? "bg-primary-muted text-primary"
                  : "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text")
              }
            >
              <Icon
                name={on ? "check" : "sparkles"}
                size={13}
                className="shrink-0"
              />
              <span className="truncate text-[12px] font-medium">{s.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-text-subtle">
                {s.tool_ids.length}t
              </span>
              {on && (
                <span
                  data-testid={`skill-${s.id}-checked`}
                  className="sr-only"
                  aria-hidden
                >
                  selected
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
