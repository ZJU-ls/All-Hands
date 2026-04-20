"use client";

import { useEffect, useState } from "react";
import {
  createEmployee,
  previewEmployeeComposition,
  updateEmployee,
  type EmployeeDto,
  type EmployeePreset,
  type SkillDto,
  type McpServerDto,
} from "@/lib/api";
import { SkillMultiPicker } from "./SkillMultiPicker";
import { McpMultiPicker } from "./McpMultiPicker";
import { PresetRadio } from "./PresetRadio";
import { DryRunPanel } from "./DryRunPanel";
import { ModelPicker } from "@/components/model-picker/ModelPicker";

/**
 * 设计表单 · 受控 state 全部在这里,**无 mode 字段**(§3.2 红线)。
 *
 * 流程:
 *  - 选 preset → 调 ``/api/employees/preview`` 拿到展开的
 *    ``(tool_ids, skill_ids, max_iterations)``,写进表单默认值
 *  - 用户可再改 skill / MCP / max_iterations
 *  - 提交前再调一次 preview 把 customs 合进去,**再** POST /api/employees
 *    —— 这样 REST(UI)与 meta tool(Lead Agent)共用同一个展开算法。
 */

export function DesignForm({
  skills,
  mcpServers,
  onCreated,
  onSaved,
  onCancel,
  initial,
}: {
  skills: SkillDto[];
  mcpServers: McpServerDto[];
  onCreated?: (emp: EmployeeDto) => void;
  onSaved?: (emp: EmployeeDto) => void;
  onCancel?: () => void;
  /** When provided, the form enters *edit* mode: fields pre-fill from this
   * employee, submit calls PATCH instead of POST, and name is readonly
   * (it's an identifier surface and renaming would break references). */
  initial?: EmployeeDto;
}) {
  const isEdit = Boolean(initial);
  // Skill IDs from initial's skill_ids; MCP IDs are stripped from the
  // ``mcp:<id>`` prefix pattern we push into tool_ids on save.
  const initialMcpIds = (initial?.tool_ids ?? [])
    .filter((t) => t.startsWith("mcp:"))
    .map((t) => t.slice(4));
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [modelRef, setModelRef] = useState(initial?.model_ref ?? "");
  const [preset, setPreset] = useState<EmployeePreset>("execute");
  const [skillIds, setSkillIds] = useState<string[]>(initial?.skill_ids ?? []);
  const [mcpIds, setMcpIds] = useState<string[]>(initialMcpIds);
  const [maxIterations, setMaxIterations] = useState<number>(initial?.max_iterations ?? 10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  const canSave = name.trim().length > 0 && !busy;

  function toggle(list: string[], id: string, setter: (v: string[]) => void) {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  useEffect(() => {
    // In edit mode the form must not trample the stored skill_ids /
    // max_iterations with the preset defaults — those are the employee's
    // actual composition the user expects to see and tweak.
    if (isEdit) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await previewEmployeeComposition({ preset });
        if (cancelled) return;
        setSkillIds(p.skill_ids);
        setMaxIterations(p.max_iterations);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preset, isEdit]);

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    setErr("");
    try {
      const customToolIds = mcpIds.map((id) => `mcp:${id}`);
      const expanded = await previewEmployeeComposition({
        preset,
        custom_tool_ids: customToolIds,
        custom_skill_ids: skillIds,
        custom_max_iterations: maxIterations,
      });
      if (isEdit && initial) {
        const emp = await updateEmployee(initial.id, {
          description: description.trim(),
          system_prompt: systemPrompt,
          model_ref: modelRef,
          tool_ids: expanded.tool_ids,
          skill_ids: expanded.skill_ids,
          max_iterations: expanded.max_iterations,
        });
        onSaved?.(emp);
      } else {
        const emp = await createEmployee({
          name: name.trim(),
          description: description.trim(),
          system_prompt: systemPrompt,
          model_ref: modelRef,
          tool_ids: expanded.tool_ids,
          skill_ids: expanded.skill_ids,
          max_iterations: expanded.max_iterations,
        });
        onCreated?.(emp);
        onSaved?.(emp);
        setName("");
        setDescription("");
        setSystemPrompt("");
        setMcpIds([]);
        setPreset("execute");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-6"
    >
      <Section title="基础信息">
        <TextField
          label="名称"
          required
          testid="field-name"
          value={name}
          onChange={setName}
          placeholder="例如 researcher-a"
        />
        <TextField
          label="描述"
          testid="field-description"
          value={description}
          onChange={setDescription}
          placeholder="一句话说明员工的职责"
        />
        <div className="flex flex-col gap-1 mb-3 last:mb-0">
          <label className="text-[11px] text-text-muted">Model</label>
          <ModelPicker
            value={modelRef}
            onChange={setModelRef}
            testId="field-model"
          />
          <p className="text-[10px] text-text-subtle">
            默认沿用平台默认模型;下拉切换时会落到员工 profile 上。
          </p>
        </div>
      </Section>

      <Section
        title="运转方式"
        subtitle="选一种 · 落库时展开为 tool_ids / skill_ids / max_iterations(不存 preset)"
      >
        <PresetRadio value={preset} onChange={setPreset} />
      </Section>

      <Section title="挂载技能" subtitle="preset 默认已勾选,可自由增减">
        <SkillMultiPicker
          skills={skills}
          selected={skillIds}
          onToggle={(id) => toggle(skillIds, id, setSkillIds)}
        />
      </Section>

      <Section
        title="挂载 MCP 服务器"
        subtitle="勾选的 MCP server 的工具会暴露给该员工"
      >
        <McpMultiPicker
          servers={mcpServers}
          selected={mcpIds}
          onToggle={(id) => toggle(mcpIds, id, setMcpIds)}
        />
      </Section>

      <Section
        title="迭代上限"
        subtitle="Agent 单次会话的最大工具调用轮次(1-50)"
      >
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={50}
            data-testid="field-max-iterations"
            value={String(maxIterations)}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(v)) setMaxIterations(v);
            }}
            className="w-24 rounded-md bg-bg border border-border px-3 py-2 text-[12px] font-mono text-text focus:outline-none focus:border-primary transition-colors duration-base"
          />
          <span className="text-[11px] text-text-muted">轮</span>
        </div>
      </Section>

      <Section title="系统提示词片段">
        <textarea
          data-testid="field-system-prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          placeholder="员工性格 / 风格 / 禁止事项"
          className="w-full rounded-md bg-bg border border-border px-3 py-2 text-[12px] text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors duration-base"
        />
      </Section>

      <Section
        title="Dry run 预览"
        subtitle="展开后的三列 —— 与落库 payload 一致"
      >
        <DryRunPanel
          preset={preset}
          customToolIds={mcpIds.map((id) => `mcp:${id}`)}
          customSkillIds={skillIds}
          customMaxIterations={maxIterations}
        />
      </Section>

      {err && (
        <p className="text-[12px] text-danger font-mono" data-testid="design-error">
          {err}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-[12px] text-text hover:bg-surface-2 transition-colors duration-base"
          >
            取消
          </button>
        )}
        <button
          type="submit"
          data-testid="design-save"
          disabled={!canSave}
          className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-[12px] font-medium transition-colors duration-base"
        >
          {busy ? "招聘中…" : "招聘"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-[12px] font-semibold text-text">{title}</h3>
        {subtitle && (
          <p className="text-[11px] text-text-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono,
  required,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  testid?: string;
}) {
  return (
    <div className="flex flex-col gap-1 mb-3 last:mb-0">
      <label className="text-[11px] text-text-muted">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </label>
      <input
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md bg-bg border border-border px-3 py-2 text-[12px] text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors duration-base ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
