"use client";

import { useState } from "react";
import { ModelPicker } from "@/components/model-picker/ModelPicker";
import {
  updateConversation,
  type ConversationDto,
  type EmployeeDto,
} from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * Per-conversation model override — L11 redesign.
 *
 * Before: chip → popover → ModelPicker → Select → listbox (four clicks from
 * "I want to switch model" to actually seeing the options). That violated
 * P11 子维度 "一屏决策" and showed up in the user's screenshot as a panel
 * fighting with the composer + sidebar.
 *
 * After: the chip IS the Select trigger. Click once, options open. The
 * override-state affordances (the pulse dot when a non-default is picked,
 * the primary-border chip when overridden) live inside `renderTrigger`.
 * The "跟随员工默认" sentinel goes straight into the options list as the
 * first group, not a separate popover layer.
 *
 * Errors from PATCH: if the save fails we mark the chip in the danger hue
 * and surface the message in `title` — no hidden inline error box that
 * the user has to hunt for.
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveRef = conversation.model_ref_override ?? employee.model_ref;
  const isOverridden = conversation.model_ref_override !== null;
  const { name: effModel } = splitRef(effectiveRef);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const title = error
    ? `切换失败 · ${error}`
    : isOverridden
      ? `本对话覆盖为 ${effectiveRef} · 默认 ${employee.model_ref}`
      : `跟随员工默认 · ${employee.model_ref}`;

  // Chip styling lives here so the Select trigger visually inherits the
  // prior look. `border-primary` when overridden keeps the original signal;
  // `border-danger` if the last PATCH blew up.
  const chipClass = cn(
    "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded border px-1.5 font-mono text-[11px] transition-colors duration-base",
    error
      ? "border-danger/60 text-danger"
      : isOverridden
        ? "border-primary text-text hover:border-border-strong"
        : "border-border text-text-muted hover:text-text hover:border-border-strong",
  );

  return (
    <ModelPicker
      value={conversation.model_ref_override ?? ""}
      onChange={(next) => {
        void handleChange(next);
      }}
      autoPickDefault={false}
      disabled={saving}
      inheritLabel={`跟随员工默认 · ${employee.model_ref}`}
      testId="model-override-chip"
      size="sm"
      triggerClassName={chipClass}
      popoverAlign="left"
      // Chip context: size to content, don't grab the flex row. Without
      // this the composer controls row collapses the ThinkingToggle +
      // CompactChip neighbours to one CJK-character-per-row min-content.
      className="shrink-0"
      renderTrigger={() => (
        <span
          className="inline-flex items-center gap-1"
          title={title}
          data-overridden={isOverridden ? "true" : "false"}
        >
          {isOverridden && (
            <span
              aria-hidden="true"
              className="inline-block h-1 w-1 rounded-full bg-primary shrink-0"
              data-testid="model-override-dot"
            />
          )}
          <span className="truncate max-w-[110px]">{effModel}</span>
        </span>
      )}
    />
  );
}
