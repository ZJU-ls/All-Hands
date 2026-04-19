"use client";

/**
 * Preset 单选 · Phase 3B 启用(SIGNOFF-agent-runtime-contract.md Q6-Q10 签完)。
 *
 * §3.2 红线:preset **不落 mode 字段**。切换 preset 时父表单订阅 onChange,
 * 把展开后的 (tool_ids, skill_ids, max_iterations) 写进 POST /api/employees
 * 的 body —— preset 本身只是 UI/契约层的一个 recipe,不入库。
 */

export type Preset = "execute" | "plan" | "plan_with_subagent";

const OPTIONS: Array<{ id: Preset; label: string; caption: string }> = [
  {
    id: "execute",
    label: "标准执行",
    caption: "直接干活 · fetch + write · 10 轮上限",
  },
  {
    id: "plan",
    label: "先出计划",
    caption: "只出结构化 plan · sk_planner · 3 轮上限",
  },
  {
    id: "plan_with_subagent",
    label: "计划+派子代理",
    caption: "出计划并派发 · spawn_subagent · 15 轮上限",
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
      className="rounded-md border border-border p-4 bg-surface-2/30 flex flex-col gap-2"
    >
      {OPTIONS.map((o) => {
        const checked = value === o.id;
        return (
          <label
            key={o.id}
            className={`flex items-start gap-3 cursor-pointer rounded-md px-2 py-1.5 transition-colors duration-base ${
              checked ? "bg-primary/5" : "hover:bg-surface-2"
            }`}
          >
            <input
              type="radio"
              name="preset"
              data-testid={`preset-${o.id}`}
              value={o.id}
              checked={checked}
              onChange={() => onChange(o.id)}
              className="mt-0.5 accent-primary"
            />
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-text">{o.label}</div>
              <div className="text-[11px] text-text-muted">{o.caption}</div>
            </div>
          </label>
        );
      })}
    </div>
  );
}
