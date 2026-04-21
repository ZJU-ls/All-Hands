"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ModelPicker } from "@/components/model-picker/ModelPicker";
import {
  updateConversation,
  type ConversationDto,
  type EmployeeDto,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  computePopoverAlign,
  computePopoverSide,
  type PopoverAlign,
  type PopoverSide,
} from "@/lib/popover-placement";

// The chip sits in the chat header; its popover carries the ModelPicker.
// Rough footprint: label row + Select trigger + one error line ≈ 140px,
// but opening the Select upward inside can add another ~280px of options.
// Estimate generously so we flip early when cramped.
const POPOVER_HEIGHT_ESTIMATE = 320;
// `w-60` on the popover — keep in sync if the width class below changes.
const POPOVER_WIDTH = 240;

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

function splitRef(ref: string | null | undefined): { provider: string; name: string } {
  // Employees seeded without a pinned model (model_ref = "") inherit the
  // bound provider's default at runtime. The chip has no cheap way to reach
  // that default synchronously, so we surface it as "默认模型" — same label
  // the /employees card uses — rather than showing an em dash that reads
  // like a broken state.
  if (!ref) return { provider: "", name: "默认模型" };
  const slash = ref.indexOf("/");
  if (slash < 0) return { provider: "", name: ref };
  return { provider: ref.slice(0, slash), name: ref.slice(slash + 1) };
}

export function ModelOverrideChip({
  conversation,
  employee,
  onConversationChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<PopoverSide>("bottom");
  const [align, setAlign] = useState<PopoverAlign>("end");
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const effectiveRef = conversation.model_ref_override ?? employee.model_ref;
  const isOverridden = conversation.model_ref_override !== null;
  const { name: effModel } = splitRef(effectiveRef);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Pick side + align on open. The chip is now used in two spots:
  //   - chat header (right-packed controls)  → end-align, bottom-prefer wins
  //   - composer control row (left-packed)   → `end` would extend left and
  //     overflow the AppShell sidebar; flip to `start`. This was the L10
  //     follow-up bug the user showed on 2026-04-22.
  // The chip sits just above the composer bottom in that second usage, so
  // vertical prefers `bottom` but we expect the flip to `top` most of the
  // time. Either way we never hard-code now.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setSide(
      computePopoverSide(rect, POPOVER_HEIGHT_ESTIMATE, window.innerHeight, "bottom"),
    );
    setAlign(
      computePopoverAlign(rect, POPOVER_WIDTH, window.innerWidth, "end"),
    );
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
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="model-override-chip"
        data-overridden={isOverridden ? "true" : "false"}
        className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[11px] transition-colors duration-base ${
          isOverridden
            ? "border-primary text-text hover:border-border-strong"
            : "border-border text-text-muted hover:text-text hover:border-border-strong"
        }`}
        title={
          isOverridden
            ? `本对话覆盖为 ${effectiveRef} · 默认 ${employee.model_ref}`
            : `跟随员工默认 · ${employee.model_ref}`
        }
      >
        {isOverridden && (
          <span
            aria-hidden="true"
            className="inline-block h-1 w-1 rounded-full bg-primary shrink-0"
            data-testid="model-override-dot"
          />
        )}
        <span className="truncate max-w-[110px]">{effModel}</span>
        <span aria-hidden className="font-mono text-text-subtle">▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="选择本对话使用的模型"
          data-side={side}
          data-align={align}
          className={cn(
            "absolute z-20 w-60 rounded-md border border-border bg-surface-1 p-2 shadow-lg",
            align === "end" ? "right-0" : "left-0",
            side === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
          )}
          data-testid="model-override-popover"
        >
          <div className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-text-subtle">
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
