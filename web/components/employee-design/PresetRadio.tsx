"use client";

import { Icon, type IconName } from "@/components/ui/icon";

/**
 * Preset 单选 · Phase 3B 启用(SIGNOFF-agent-runtime-contract.md Q6-Q10 签完)。
 *
 * §3.2 红线:preset **不落 mode 字段**。切换 preset 时父表单订阅 onChange,
 * 把展开后的 (tool_ids, skill_ids, max_iterations) 写进 POST /api/employees
 * 的 body —— preset 本身只是 UI/契约层的一个 recipe,不入库。
 *
 * V2 (ADR 0016): radio cards. Selected card = `bg-primary-muted border-primary/40
 * ring-4 ring-primary/10` with a sparkles glyph in the top-right corner; the
 * native radio input is visually hidden but preserved for keyboard/a11y and to
 * keep the `preset-<id>` test id.
 */

export type Preset = "execute" | "plan" | "plan_with_subagent";

const OPTIONS: Array<{
  id: Preset;
  label: string;
  caption: string;
  icon: IconName;
}> = [
  {
    id: "execute",
    label: "标准执行",
    caption: "直接干活 · fetch + write · 10 轮上限",
    icon: "zap",
  },
  {
    id: "plan",
    label: "先出计划",
    caption: "只出结构化 plan · sk_planner · 3 轮上限",
    icon: "book-open",
  },
  {
    id: "plan_with_subagent",
    label: "计划+派子代理",
    caption: "出计划并派发 · spawn_subagent · 15 轮上限",
    icon: "users",
  },
];

export function PresetRadio({
  value,
  onChange,
}: {
  value: Preset;
  onChange: (next: Preset) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="运转方式"
      className="grid gap-2 sm:grid-cols-3"
    >
      {OPTIONS.map((o) => {
        const checked = value === o.id;
        return (
          <label
            key={o.id}
            className={
              "relative flex cursor-pointer flex-col gap-1.5 overflow-hidden rounded-xl border p-3 transition-colors duration-fast " +
              (checked
                ? "border-primary/40 bg-primary-muted ring-4 ring-primary/10"
                : "border-border bg-surface hover:border-border-strong hover:bg-surface-2")
            }
          >
            <input
              type="radio"
              name="preset"
              data-testid={`preset-${o.id}`}
              value={o.id}
              checked={checked}
              onChange={() => onChange(o.id)}
              className="sr-only"
            />
            {checked && (
              <span
                aria-hidden
                className="absolute right-2 top-2 text-primary"
              >
                <Icon name="sparkles" size={14} />
              </span>
            )}
            <span
              className={
                "inline-flex h-7 w-7 items-center justify-center rounded-lg " +
                (checked
                  ? "bg-primary/20 text-primary"
                  : "bg-surface-2 text-text-muted")
              }
            >
              <Icon name={o.icon} size={14} />
            </span>
            <div className="min-w-0">
              <div
                className={
                  "text-[13px] font-semibold " +
                  (checked ? "text-primary" : "text-text")
                }
              >
                {o.label}
              </div>
              <div className="text-[11px] text-text-muted">{o.caption}</div>
            </div>
          </label>
        );
      })}
    </div>
  );
}
