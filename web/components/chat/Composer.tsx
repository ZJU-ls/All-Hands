"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowUpIcon } from "@/components/icons";

/**
 * Composer — unified AI-native chat input (I-0015 spec).
 *
 * Layout (matches ChatGPT / Claude.ai / DeepSeek / Kimi convention):
 *
 *   ┌────────────────────────────────────────────────┐
 *   │  textarea ...                         [send]   │  send pinned right;
 *   │                                                │  streaming → same
 *   │  [think] [model] [attach]                      │  button becomes stop
 *   └────────────────────────────────────────────────┘  (via `isStreaming`)
 *
 * One button does both "send" and "stop". Click while `isStreaming` calls
 * `onAbort`; click otherwise calls `onSend`. No scale/shadow transitions;
 * we only swap the inner glyph (arrow → filled-square geometric primitive).
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
      className="rounded-md border border-border bg-bg focus-within:border-primary transition-colors duration-fast"
    >
      <div className="flex items-start gap-2 px-3 pt-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={rows}
          placeholder={placeholder}
          disabled={textareaDisabled}
          data-testid="composer-textarea"
          className="flex-1 resize-none bg-transparent text-sm text-text placeholder-text-subtle outline-none disabled:opacity-60"
        />
        <SendOrStopButton
          isStreaming={isStreaming}
          canSend={canSend}
          onClick={handleClick}
        />
      </div>
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        <div
          data-testid="composer-controls"
          className="flex min-h-[24px] flex-1 items-center gap-2 text-[11px] text-text-muted"
        >
          {controls}
        </div>
        {controlsTrailing && (
          <div className="font-mono text-[10px] text-text-subtle">{controlsTrailing}</div>
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
  // One button, two glyphs. No scale/shadow transitions — only color + inner glyph swap.
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
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center self-end rounded bg-primary text-primary-fg transition-colors duration-fast hover:bg-primary-hover disabled:bg-surface-2 disabled:text-text-subtle"
    >
      {isStreaming ? (
        <span
          aria-hidden="true"
          className="block h-2.5 w-2.5 rounded-sm bg-current"
          data-testid="composer-stop-glyph"
        />
      ) : (
        <ArrowUpIcon size={14} />
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
      className={`inline-flex h-6 items-center gap-1.5 rounded border px-2 text-[11px] transition-colors duration-fast disabled:opacity-40 ${
        enabled
          ? "border-primary/60 bg-primary/10 text-primary"
          : "border-border bg-transparent text-text-muted hover:text-text hover:border-border-strong"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          enabled ? "bg-primary" : "bg-text-subtle"
        }`}
      />
      {label}
    </button>
  );
}
