"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "@/components/ui/icon";
import { isImeComposing } from "@/lib/ime";
import { cn } from "@/lib/cn";

/**
 * Composer — unified AI-native chat input (I-0015 spec · Brand Blue V2 polish).
 *
 * Layout (matches ChatGPT / Claude.ai / DeepSeek / Kimi convention):
 *
 *   ┌────────────────────────────────────────────────┐
 *   │  textarea ...                         [send]   │  send pinned right;
 *   │                                                │  streaming → same
 *   │  [think] [model] [attach]                      │  button becomes stop
 *   └────────────────────────────────────────────────┘
 *
 * One button does both "send" and "stop". Click while `isStreaming` calls
 * `onAbort`; click otherwise calls `onSend`. The send button is the primary
 * CTA — solid primary fill + focus glow — so users' eyes always find it.
 *
 * Controls (thinking toggle, model picker, attach) are injected via the
 * `controls` slot so each consumer decides what the current surface needs.
 */

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onAbort?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  /** Extra controls rendered in the bottom ControlBar (thinking / model / attach). */
  controls?: ReactNode;
  /** Trailing hint shown at the right of the ControlBar (e.g. "⌘↵ 发送"). */
  controlsTrailing?: ReactNode;
  /** data-testid passthrough for e2e hooks. */
  testId?: string;
  /** When true the textarea keeps enabled during streaming (for queued input UX). Defaults to true. */
  keepTextareaEnabledWhileStreaming?: boolean;
};

export type ComposerHandle = {
  focus: () => void;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    value,
    onChange,
    onSend,
    onAbort,
    isStreaming = false,
    disabled = false,
    placeholder = "输入消息…",
    rows = 2,
    controls,
    controlsTrailing,
    testId,
    keepTextareaEnabledWhileStreaming = true,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  const canSend = !isStreaming && !disabled && value.trim().length > 0;

  const handleClick = useCallback(() => {
    if (isStreaming) {
      onAbort?.();
      return;
    }
    if (canSend) onSend();
  }, [isStreaming, onAbort, canSend, onSend]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") return;
      if (isImeComposing(event, isComposingRef.current)) return;
      // ⌘↵ / Ctrl↵ always sends; bare Enter (no shift) also sends as the
      // convention on chat-first AI products. Shift+Enter keeps newline.
      const metaSend = event.metaKey || event.ctrlKey;
      if (event.shiftKey && !metaSend) return;
      event.preventDefault();
      if (isStreaming) {
        onAbort?.();
        return;
      }
      if (canSend) onSend();
    },
    [isStreaming, onAbort, canSend, onSend],
  );

  const textareaDisabled = disabled || (isStreaming && !keepTextareaEnabledWhileStreaming);

  return (
    <div
      data-testid={testId ?? "composer"}
      data-streaming={isStreaming ? "true" : undefined}
      className={cn(
        "rounded-xl border border-border bg-surface transition-colors duration-base",
        "focus-within:border-primary focus-within:shadow-glow-sm",
      )}
    >
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onKeyDown={handleKeyDown}
          rows={rows}
          placeholder={placeholder}
          disabled={textareaDisabled}
          data-testid="composer-textarea"
          className="flex-1 resize-none bg-transparent text-[14px] leading-[1.55] text-text placeholder-text-subtle outline-none disabled:opacity-60"
        />
        <SendOrStopButton
          isStreaming={isStreaming}
          canSend={canSend}
          onClick={handleClick}
        />
      </div>
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1.5">
        <div
          data-testid="composer-controls"
          className="flex min-h-[28px] flex-1 items-center gap-2 text-[11px] text-text-muted"
        >
          {controls}
        </div>
        {controlsTrailing && (
          <div className="shrink-0 whitespace-nowrap font-mono text-[10px] text-text-subtle">
            {controlsTrailing}
          </div>
        )}
      </div>
    </div>
  );
});

function SendOrStopButton({
  isStreaming,
  canSend,
  onClick,
}: {
  isStreaming: boolean;
  canSend: boolean;
  onClick: () => void;
}) {
  // One button, two glyphs. Solid primary fill when armed, surface-2 when
  // idle; stop variant keeps the primary so the user can abort easily.
  const disabled = !isStreaming && !canSend;
  const label = isStreaming ? "停止" : "发送";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid={isStreaming ? "composer-stop" : "composer-send"}
      data-state={isStreaming ? "streaming" : canSend ? "ready" : "idle"}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-lg",
        "transition-colors duration-fast",
        disabled
          ? "bg-surface-2 text-text-subtle"
          : "bg-primary text-primary-fg shadow-soft-sm hover:bg-primary-hover",
      )}
    >
      {isStreaming ? (
        <span
          aria-hidden="true"
          className="block h-2.5 w-2.5 rounded-sm bg-current"
          data-testid="composer-stop-glyph"
        />
      ) : (
        <Icon name="arrow-up" size={14} strokeWidth={2} />
      )}
    </button>
  );
}

/**
 * ThinkingToggle — composable chip for the Composer `controls` slot.
 * Pure presentation; caller owns the boolean.
 */
export function ThinkingToggle({
  enabled,
  onChange,
  label = "深度思考",
  disabled = false,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      data-testid="composer-thinking-toggle"
      data-state={enabled ? "on" : "off"}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] transition-colors duration-fast disabled:opacity-50",
        enabled
          ? "border-primary/40 bg-primary-muted text-primary"
          : "border-border bg-surface text-text-muted hover:text-text hover:border-border-strong hover:bg-surface-2",
      )}
    >
      <Icon
        name="brain"
        size={12}
        className={enabled ? "text-primary" : "text-text-subtle"}
      />
      {label}
    </button>
  );
}
