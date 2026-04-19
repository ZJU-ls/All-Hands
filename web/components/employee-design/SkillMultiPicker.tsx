"use client";

import { SkillIcon, CheckIcon } from "@/components/icons";
import type { SkillDto } from "@/lib/api";

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
    <ul className="flex flex-col gap-1">
      {skills.map((s) => {
        const on = selected.includes(s.id);
        return (
          <li key={s.id}>
            <button
              type="button"
              data-testid={`skill-${s.id}`}
              aria-pressed={on}
              onClick={() => onToggle(s.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border transition-colors duration-base text-left ${
                on
                  ? "border-primary/60 bg-primary/5"
                  : "border-border hover:bg-surface-2"
              }`}
            >
              <SkillIcon size={14} className="text-text-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-text">{s.name}</div>
                {s.description && (
                  <div className="text-[11px] text-text-muted truncate">{s.description}</div>
                )}
              </div>
              <span className="font-mono text-[10px] text-text-subtle shrink-0">
                {s.tool_ids.length} tools
              </span>
              {on && <CheckIcon size={14} className="text-primary shrink-0" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
