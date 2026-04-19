"use client";

import { useState } from "react";
import {
  createEmployee,
  type EmployeeDto,
  type SkillDto,
  type McpServerDto,
} from "@/lib/api";
import { SkillMultiPicker } from "./SkillMultiPicker";
import { McpMultiPicker } from "./McpMultiPicker";
import { PresetRadio } from "./PresetRadio";

/**
 * 设计表单 · 受控 state 全部在这里,**无 mode 字段**(§3.2 红线)。
 * 保存走 POST /api/employees(L01 扩展 · 与 create_employee meta tool 对偶)。
 */

export function DesignForm({
  skills,
  mcpServers,
  onCreated,
  onCancel,
}: {
  skills: SkillDto[];
  mcpServers: McpServerDto[];
  onCreated: (emp: EmployeeDto) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelRef, setModelRef] = useState("openai/gpt-4o-mini");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [mcpIds, setMcpIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  const canSave = name.trim().length > 0 && !busy;

  function toggle(list: string[], id: string, setter: (v: string[]) => void) {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    setErr("");
    try {
      // 每个勾选的 MCP 服务器暴露出若干 tool,这里先把选中 ID 作为 tool 前缀注入
      // tool_ids —— 后端把它们与 skill 合并去重。Phase 3B 契约落地后改走 preset。
      const tool_ids = mcpIds.map((id) => `mcp:${id}`);
      const emp = await createEmployee({
        name: name.trim(),
        description: description.trim(),
        system_prompt: systemPrompt,
        model_ref: modelRef,
        tool_ids,
        skill_ids: skillIds,
        max_iterations: 10,
      });
      onCreated(emp);
      // 清空表单
      setName("");
      setDescription("");
      setSystemPrompt("");
      setSkillIds([]);
      setMcpIds([]);
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
        <TextField
          label="Model"
          mono
          testid="field-model"
          value={modelRef}
          onChange={setModelRef}
          placeholder="openai/gpt-4o-mini"
        />
      </Section>

      <Section
        title="运转方式"
        subtitle="单选 · 落库时展开为 tool_ids / skill_ids / max_iterations(不存 mode)"
      >
        <PresetRadio />
      </Section>

      <Section
        title="挂载技能"
        subtitle="勾选的 skill 在员工启动时与基础 tool 合并"
      >
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
        {subtitle && <p className="text-[11px] text-text-muted mt-0.5">{subtitle}</p>}
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
