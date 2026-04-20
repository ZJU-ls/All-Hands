"use client";

import { useEffect, useRef, useState } from "react";
import { ModelPicker } from "@/components/model-picker/ModelPicker";
import {
  updateConversation,
  type ConversationDto,
  type EmployeeDto,
} from "@/lib/api";

/**
 * Per-conversation model override control (Track ζ).
 *
 * Renders a compact chip in the chat header that shows the effective model
 * (override → falls back to the employee's model_ref) and, on click, opens
 * an inline popover with a ModelPicker offering "跟随员工默认" as the first
 * option. The "跟随" option clears the override via PATCH + clear flag.
 *
 * The chip shape (dark border + 10-11px mono) tracks the rest of the chat
 * header so the override feels like a status readout rather than a primary
 * action — following P02 (prominence matches intent).
 */

type Props = {
  conversation: ConversationDto;
  employee: EmployeeDto;
  onConversationChange: (next: ConversationDto) => void;
};

function modelShortLabel(ref: string | null | undefined): string {
  if (!ref) return "—";
  const [provider, name] = ref.split("/", 2);
  if (!name) return ref;
  return `${provider} · ${name}`;
}

export function ModelOverrideChip({
  conversation,
  employee,
  onConversationChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const effectiveRef = conversation.model_ref_override ?? employee.model_ref;
  const isOverridden = conversation.model_ref_override !== null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function handleChange(next: string) {
    setSaving(true);
    setError(null);
    try {
      const body =
        next === ""
          ? { clear_model_ref_override: true }
          : { model_ref_override: next };
      const updated = await updateConversation(conversation.id, body);
      onConversationChange(updated);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="model-override-chip"
        data-overridden={isOverridden ? "true" : "false"}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-[10px] uppercase tracking-wider transition-colors duration-base ${
          isOverridden
            ? "border-primary text-primary hover:border-border-strong"
            : "border-border text-text-muted hover:text-text hover:border-border-strong"
        }`}
        title={
          isOverridden
            ? `本对话覆盖为 ${effectiveRef} · 默认 ${employee.model_ref}`
            : `跟随员工默认 · ${employee.model_ref}`
        }
      >
        <span className="text-text-subtle">模型</span>
        <span className="normal-case">{modelShortLabel(effectiveRef)}</span>
        {isOverridden && (
          <span
            className="text-primary"
            aria-label="已覆盖"
            data-testid="model-override-dot"
          >
            •
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="选择本对话使用的模型"
          className="absolute right-0 top-full mt-1 z-20 w-72 rounded-md border border-border bg-surface-1 p-3 shadow-lg"
          data-testid="model-override-popover"
        >
          <div className="mb-2 text-[10px] font-mono uppercase tracking-wider text-text-subtle">
            本对话使用的模型
          </div>
          <ModelPicker
            value={conversation.model_ref_override ?? ""}
            onChange={(next) => {
              void handleChange(next);
            }}
            autoPickDefault={false}
            disabled={saving}
            inheritLabel={`跟随员工默认 · ${employee.model_ref}`}
            testId="model-override-picker"
          />
          {error && (
            <div
              className="mt-2 font-mono text-[11px] text-danger"
              data-testid="model-override-error"
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
