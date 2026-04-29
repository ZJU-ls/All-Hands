"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { openStream, type AgUiCallbacks, type StreamHandle } from "@/lib/stream-client";
import { useChatStore } from "@/lib/store";
import type { RenderPayload, ToolCall, ToolCallStatus } from "@/lib/protocol";
import type { ConversationDto, EmployeeDto } from "@/lib/api";
import {
  makeLocalId,
  preflight,
  uploadAttachment,
  type LocalAttachment,
} from "@/lib/attachments";
import { Icon } from "@/components/ui/icon";
import { Composer, ThinkingToggle } from "./Composer";
import { UsageChip } from "./UsageChip";
import { ModelOverrideChip } from "./ModelOverrideChip";
import { CompactChip } from "./CompactChip";
import { AttachmentChips } from "./AttachmentChips";
import { CapabilityBanner } from "./CapabilityBanner";

type Props = {
  conversationId: string;
  /** The employee's default model ref, used to resolve the context window
   * size for the usage chip. Omit to hide the chip. */
  employeeModelRef?: string;
  /** Conversation + employee passed through so the Composer controls can
   * host the per-conversation model override directly (picker next to the
   * thinking toggle, same surface as ChatGPT / DeepSeek). Omit to hide. */
  conversation?: ConversationDto | null;
  employee?: EmployeeDto | null;
  onConversationChange?: (next: ConversationDto) => void;
  /**
   * 2026-04-28 · run_id of an in-flight broker run for this conversation,
   * resolved on chat-page mount from `getConversation()`. When non-null
   * the InputBar opens an SSE subscriber to `POST /runs/{id}/subscribe`
   * instead of waiting for the user to send a new turn — the buffered
   * events replay and the live tail attaches in-place. Mirrors the
   * AgUiCallbacks the send handler builds, so all the state machinery
   * (reasoning, tool calls, render envelopes, confirmations) reuses
   * the same wiring.
   */
  initialActiveRunId?: string | null;
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type ToolCallAccumulator = {
  id: string;
  name: string;
  argsBuf: string;
  started: boolean;
  // Last terminal status — preserved across separate END/RESULT frames so
  // RESULT (which inspects the envelope for `{error}`) wins over a generic
  // END that can't tell success from failure.
  lastStatus?: "pending" | "running" | "succeeded" | "failed";
};

export function InputBar({
  conversationId,
  employeeModelRef,
  conversation,
  employee,
  onConversationChange,
  initialActiveRunId,
}: Props) {
  const t = useTranslations("chat.inputBar");
  const tAtt = useTranslations("chat.attachments");
  const [value, setValue] = useState("");
  const [thinking, setThinking] = useState(false);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  // Inline rejection notices for files that failed pre-flight (size /
  // mime). Replaces `alert()` which stole textarea focus and made the
  // composer untypeable until the user clicked back into it.
  const [rejections, setRejections] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [modelSupportsImages, setModelSupportsImages] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<StreamHandle | null>(null);
  const {
    isStreaming,
    beginTurn,
    startStreaming,
    appendToken,
    appendReasoning,
    updateToolCall,
    addRenderPayload,
    addConfirmation,
    addUserInput,
    addMessage,
    finalizeStreaming,
    cancelStreaming,
    setStreamError,
    bumpHeartbeat,
  } = useChatStore();

  // ADR 0014 Phase 4e · build the AG-UI stream callbacks once per render so
  // both /messages and /resume SSE consumers get the same token / tool_call
  // / render / confirmation dispatch. Extracted from the send handler so the
  // resume path (triggered by ConfirmationDialog) reuses it unchanged.
  const buildStreamCallbacks = useCallback((): AgUiCallbacks => {
    const toolCalls = new Map<string, ToolCallAccumulator>();
    return {
      onTextMessageStart: (f) => {
        startStreaming(f.messageId);
      },
      onTextMessageContent: (f) => {
        appendToken(f.messageId, f.delta);
      },
      onReasoningMessageChunk: (f) => {
        appendReasoning(f.messageId, f.delta);
      },
      onToolCallStart: (f) => {
        toolCalls.set(f.toolCallId, {
          id: f.toolCallId,
          name: f.toolCallName,
          argsBuf: "",
          started: false,
        });
      },
      onToolCallArgs: (f) => {
        const acc = toolCalls.get(f.toolCallId);
        if (!acc) return;
        acc.argsBuf += f.delta;
        if (!acc.started) {
          acc.started = true;
          updateToolCall(materializeToolCall(acc, "pending"));
        }
      },
      onToolCallEnd: (f) => {
        const acc = toolCalls.get(f.toolCallId);
        if (!acc) return;
        // Don't unconditionally stamp succeeded — TOOL_CALL_RESULT carries
        // the real envelope; if it's already arrived (some adapters fire
        // result before end), preserve whatever status we already set.
        const existing = acc.lastStatus;
        updateToolCall(materializeToolCall(acc, existing ?? "succeeded"));
      },
      onToolCallResult: (f) => {
        const acc = toolCalls.get(f.toolCallId);
        if (!acc) return;
        // Inspect the tool result for an error envelope (R2 review · agent
        // diagnosis): tool_pipeline returns {"error": "..."} for any
        // executor failure / permission denied / confirmation expired /
        // unknown-tool path. Without this check, every failed tool was
        // displayed as ✓ ok with the error tucked inside an expanded card —
        // a misleading green checkmark on what's really a failure.
        const errorMessage = extractErrorEnvelope(f.content);
        const status = errorMessage ? "failed" : "succeeded";
        acc.lastStatus = status;
        const tc = materializeToolCall(acc, status, f.content);
        if (errorMessage) tc.error = errorMessage;
        updateToolCall(tc);
      },
      onCustom: (name, value) => {
        if (name === "allhands.confirm_required") {
          const ev = (value ?? {}) as {
            confirmation_id?: string;
            tool_call_id?: string;
            summary?: string;
            rationale?: string;
            diff?: Record<string, unknown> | null;
          };
          if (!ev.confirmation_id || !ev.tool_call_id) return;
          addConfirmation({
            confirmationId: ev.confirmation_id,
            toolCallId: ev.tool_call_id,
            summary: ev.summary ?? "",
            rationale: ev.rationale ?? "",
            diff: ev.diff,
            conversationId,
            source: "polling",
          });
        } else if (name === "allhands.user_input_required") {
          // ADR 0019 C3 · clarification (ask_user_question) paused mid-turn.
          const ev = (value ?? {}) as {
            user_input_id?: string;
            tool_call_id?: string;
            questions?: Array<{
              label?: string;
              description?: string;
              preview?: string | null;
            }>;
          };
          if (!ev.user_input_id || !ev.tool_call_id) return;
          const normalized = (ev.questions ?? []).map((q) => ({
            label: q.label ?? "",
            description: q.description ?? "",
            preview: q.preview ?? null,
          }));
          addUserInput({
            userInputId: ev.user_input_id,
            toolCallId: ev.tool_call_id,
            questions: normalized,
          });
        } else if (name === "allhands.render") {
          const ev = (value ?? {}) as {
            message_id?: string;
            payload?: RenderPayload;
          };
          if (!ev.message_id || !ev.payload) return;
          addRenderPayload(ev.message_id, ev.payload);
        } else if (name === "allhands.heartbeat") {
          // 2026-04-26 · 服务端 10s 一次心跳 · 让 chip 的「无响应」 计时
          // reset · 否则 LLM 长 thinking 期间 chip 会错误地进入「停止」 状态。
          bumpHeartbeat();
        }
      },
      onRunError: (err) => {
        setStreamError({
          message: err.message || t("assistantFailed"),
          code: err.code,
        });
        finalizeStreaming(conversationId);
      },
      onRunFinished: () => {
        finalizeStreaming(conversationId);
      },
      onDone: () => {
        finalizeStreaming(conversationId);
        streamRef.current = null;
      },
      onError: (err) => {
        setStreamError({ message: err.message || String(err) });
        cancelStreaming();
        streamRef.current = null;
      },
    };
  }, [
    conversationId,
    startStreaming,
    appendToken,
    appendReasoning,
    updateToolCall,
    addRenderPayload,
    addConfirmation,
    addUserInput,
    finalizeStreaming,
    cancelStreaming,
    setStreamError,
    bumpHeartbeat,
    t,
  ]);

  // ---- Capability lookup: does the current employee's model support images?
  // Tries the model gateway. The result is cached per ref string in module
  // memory to avoid hammering the API on every render.
  useEffect(() => {
    let cancelled = false;
    const ref = employee?.model_ref || employeeModelRef;
    if (!ref) {
      setModelSupportsImages(null);
      return;
    }
    void (async () => {
      try {
        const cached = capabilityCache.get(ref);
        if (cached !== undefined) {
          if (!cancelled) setModelSupportsImages(cached);
          return;
        }
        const res = await fetch(`${BASE}/api/models`);
        if (!res.ok) return;
        const all = (await res.json()) as Array<{
          name: string;
          provider_id: string;
          supports_images: boolean;
        }>;
        // model_ref is "<provider name>/<model name>" — match on suffix.
        const slash = ref.indexOf("/");
        const modelName = slash >= 0 ? ref.slice(slash + 1) : ref;
        const found = all.find((m) => m.name === modelName);
        const flag = found ? found.supports_images : false;
        capabilityCache.set(ref, flag);
        if (!cancelled) setModelSupportsImages(flag);
      } catch {
        if (!cancelled) setModelSupportsImages(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employee?.model_ref, employeeModelRef]);

  // ---- File handling ------------------------------------------------------
  const enqueueFiles = useCallback(
    (files: FileList | File[]) => {
      const filesArray = Array.from(files);
      const queued: LocalAttachment[] = [];
      const rejected: string[] = [];
      for (const file of filesArray) {
        const pre = preflight(file);
        if (!pre.ok) {
          rejected.push(`${file.name}: ${tAtt(`reject.${pre.reason}`)}`);
          continue;
        }
        const previewUrl = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null;
        queued.push({
          localId: makeLocalId(),
          file,
          previewUrl,
          status: { state: "queued" },
        });
      }
      if (rejected.length > 0) {
        // Inline notice (auto-dismiss after 5 s) instead of alert(),
        // which stole textarea focus and made the composer untypeable.
        setRejections((prev) => [...prev, ...rejected]);
        window.setTimeout(
          () => setRejections((prev) => prev.slice(rejected.length)),
          5000,
        );
      }
      if (queued.length === 0) return;
      setAttachments((prev) => [...prev, ...queued]);
      // Kick off uploads concurrently.
      for (const att of queued) {
        void uploadOne(att);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId, tAtt],
  );

  const uploadOne = useCallback(
    async (att: LocalAttachment) => {
      const update = (next: LocalAttachment["status"]) =>
        setAttachments((prev) =>
          prev.map((x) => (x.localId === att.localId ? { ...x, status: next } : x)),
        );
      update({ state: "uploading", progress: { loaded: 0, total: att.file.size } });
      try {
        const dto = await uploadAttachment(att.file, {
          conversationId,
          onProgress: (p) =>
            update({ state: "uploading", progress: p }),
        });
        update({ state: "uploaded", dto });
      } catch (e) {
        update({ state: "failed", error: String(e instanceof Error ? e.message : e) });
      }
    },
    [conversationId],
  );

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  }, []);

  // Drag & drop
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) enqueueFiles(e.dataTransfer.files);
    },
    [enqueueFiles],
  );

  // Paste handler (clipboard images / files)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        enqueueFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enqueueFiles]);

  const onFilePickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) enqueueFiles(files);
      e.target.value = "";
    },
    [enqueueFiles],
  );

  const allUploaded = attachments.every((a) => a.status.state === "uploaded");
  const anyFailed = attachments.some((a) => a.status.state === "failed");
  const canSendWithContent = useMemo(
    () =>
      (value.trim().length > 0 || attachments.length > 0) &&
      attachments.length > 0
        ? allUploaded && !anyFailed
        : true,
    [value, attachments.length, allUploaded, anyFailed],
  );

  const handleSend = useCallback(() => {
    if (isStreaming) return;
    const content = value.trim();
    if (!content && attachments.length === 0) return;
    if (attachments.length > 0 && (!allUploaded || anyFailed)) return;

    // Snapshot uploaded attachment ids and dtos before clearing the chip
    // strip — the optimistic message bubble + the POST body see the same set.
    const attachmentIds: string[] = [];
    const attachmentDtos = [];
    for (const a of attachments) {
      if (a.status.state === "uploaded") {
        attachmentIds.push(a.status.dto.id);
        attachmentDtos.push(a.status.dto);
      }
    }
    setValue("");
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttachments([]);

    // Flip `isStreaming` now so the MessageList can paint a pending bubble
    // before the first token lands — otherwise the UI sits silent for the
    // POST round-trip + provider cold-start latency and looks broken.
    beginTurn();
    addMessage({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: "user",
      content,
      tool_calls: [],
      render_payloads: [],
      created_at: new Date().toISOString(),
      attachment_ids: attachmentIds,
      attachments: attachmentDtos,
    });

    // Model params (temperature / top_p / max_tokens / system override) are
    // deliberately not configurable per-turn from the chat surface — those
    // belong on the employee design page and are inherited here. The chat
    // only carries `thinking` (a per-turn user action) forward.
    //
    // IMPORTANT (E17): always send the boolean, never omit. Omitting leaves
    // `SendMessageRequest.thinking = None` on the backend, which the runner
    // reads as "inherit provider default" — and DashScope/Qwen3 defaults to
    // `enable_thinking=true`. Result: grayed toggle, reasoning still streams.
    // Explicit `false` hits `extra_body={"enable_thinking": false}` downstream
    // and the model stops thinking for real.
    const body: Record<string, unknown> = { content, thinking };
    if (attachmentIds.length > 0) {
      body.attachment_ids = attachmentIds;
    }

    const handle = openStream(
      `${BASE}/api/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      buildStreamCallbacks(),
    );
    streamRef.current = handle;
  }, [
    value,
    isStreaming,
    thinking,
    conversationId,
    addMessage,
    beginTurn,
    buildStreamCallbacks,
    attachments,
    allUploaded,
    anyFailed,
  ]);

  // 2026-04-28 · auto-resubscribe to in-flight runs.
  //
  // ChatPage hands us the `active_run_id` it read from GET
  // /api/conversations/{id}. When non-null, an agent is still streaming
  // events into the broker — the user just opened a tab onto a run that
  // started earlier (after a refresh, a route change away-and-back, or
  // even another tab). Hook into POST /runs/{id}/subscribe; the same
  // AG-UI v1 wire shape replays buffered events then attaches to the
  // live tail. Disconnect path is identical to a normal turn.
  useEffect(() => {
    if (!initialActiveRunId) return;
    if (streamRef.current) return; // a fresh send already started
    beginTurn();
    const handle = openStream(
      `${BASE}/api/conversations/${conversationId}/runs/${encodeURIComponent(
        initialActiveRunId,
      )}/subscribe`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      buildStreamCallbacks(),
    );
    streamRef.current = handle;
    return () => {
      handle.abort();
      if (streamRef.current === handle) streamRef.current = null;
    };
    // intentionally not depending on buildStreamCallbacks — that
    // useCallback rebuilds on every store-state change and would
    // restart the resubscribe loop. The effect is mount-only by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, initialActiveRunId, beginTurn]);

  // ADR 0018 · resume protocol simplified to a single round-trip.
  // ConfirmationDialog flips the Confirmation row directly via
  // /api/confirmations/{id}/resolve; the backend's polling
  // DeferredSignal sees the flip and unblocks the in-flight /messages
  // SSE. No second SSE, no client-side resume bookkeeping.

  const handleAbort = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    cancelStreaming();
  }, [cancelStreaming]);

  // 2026-04-25 · MessageList's stalled-stream chip dispatches `chat:abort`
  // when the user clicks 「停止」 on a hung stream. Sibling components can't
  // share `streamRef` directly without lifting it up; a window-level event
  // is the smallest seam that doesn't redesign the chat layout.
  useEffect(() => {
    const onAbort = () => handleAbort();
    window.addEventListener("chat:abort", onAbort);
    return () => window.removeEventListener("chat:abort", onAbort);
  }, [handleAbort]);

  // Abort any in-flight SSE when the conversation switches (or on unmount).
  // Without this, navigating away mid-stream leaves the previous chat's
  // tokens writing into the global store, which then bleeds into the next
  // conversation's view.
  useEffect(() => {
    return () => {
      streamRef.current?.abort();
      streamRef.current = null;
    };
  }, [conversationId]);

  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`mx-auto flex w-full max-w-6xl flex-col gap-2 border-t border-border bg-bg px-4 pb-4 pt-3 transition-colors ${
        isDragging ? "outline outline-2 outline-primary outline-offset-[-8px]" : ""
      }`}
    >
      {isDragging && (
        <div
          className="pointer-events-none rounded-lg border-2 border-dashed border-primary bg-primary/5 px-4 py-3 text-center text-[13px] text-primary"
          data-testid="dropzone-overlay"
        >
          <Icon name="upload" size={14} className="mr-1 inline-block" />
          {tAtt("dropHint")}
        </div>
      )}
      <CapabilityBanner
        attachments={attachments}
        modelSupportsImages={modelSupportsImages}
        modelDisplayName={(employee?.model_ref || employeeModelRef || "").split("/").pop()}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={onFilePickerChange}
        accept="image/*,.pdf,.docx,.xlsx,.pptx,.txt,.md,.json,.csv,.xml,.yaml,.yml,.html"
      />
      <div className="rounded-xl border border-border bg-surface">
        {rejections.length > 0 && (
          <div
            data-testid="upload-rejections"
            className="border-b border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-warning"
          >
            {rejections.map((msg, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Icon name="alert-triangle" size={12} className="mt-[3px] shrink-0" />
                <span>{msg}</span>
              </div>
            ))}
          </div>
        )}
        <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
        <Composer
          value={value}
          onChange={setValue}
          onSend={handleSend}
          onAbort={handleAbort}
          isStreaming={isStreaming}
          placeholder={t("placeholder")}
          rows={3}
          // CRITICAL: don't pass `disabled` here — that would block the
          // textarea entirely on upload failure, costing the user their
          // focus + ability to type. Use `sendDisabled` to gate only the
          // send button so they can still compose / remove failed chips.
          sendDisabled={!canSendWithContent && (value.trim().length > 0 || attachments.length > 0)}
          controls={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title={tAtt("attachTitle")}
                className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-primary"
                data-testid="attach-button"
              >
                <Icon name="paperclip" size={14} />
              </button>
              <ThinkingToggle
                enabled={thinking}
                onChange={setThinking}
                disabled={isStreaming}
              />
              {conversation && employee && onConversationChange && (
                <ModelOverrideChip
                  conversation={conversation}
                  employee={employee}
                  onConversationChange={onConversationChange}
                />
              )}
              {employeeModelRef && (
                <UsageChip
                  conversationId={conversationId}
                  employeeModelRef={employeeModelRef}
                  disabled={isStreaming}
                />
              )}
              <CompactChip
                conversationId={conversationId}
                disabled={isStreaming}
              />
            </div>
          }
          controlsTrailing={<span className="font-mono">{t("hint")}</span>}
        />
      </div>
    </div>
  );
}

// Module-scope cache for model.supports_images lookups keyed on model_ref.
// Cleared on hard reload; small enough to forget about.
const capabilityCache = new Map<string, boolean>();

/** Tool result envelopes produced by `tool_pipeline.py` look like:
 *   - success: anything (string, dict, list)
 *   - failure: { "error": "<reason>" }
 * Frontend was always stamping "succeeded" on TOOL_CALL_END/RESULT regardless,
 * so genuine failures (permission denied, expired confirmation, executor
 * exception) were rendered with a green ✓ — extremely misleading. R2
 * diagnosis caught this. Returns the error message string when the envelope
 * is a failure, null otherwise.
 */
function extractErrorEnvelope(rawContent: string | undefined | null): string | null {
  if (!rawContent) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return null;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "error" in (parsed as Record<string, unknown>)
  ) {
    const err = (parsed as Record<string, unknown>).error;
    if (typeof err === "string") return err;
    return JSON.stringify(err);
  }
  return null;
}

/** Flatten an accumulator into the canonical ToolCall shape expected by the
 * chat store. TOOL_CALL_ARGS frames ship JSON fragments; we only parse when
 * we have the whole buffer so partial deltas don't crash on malformed JSON.
 */
function materializeToolCall(
  acc: ToolCallAccumulator,
  status: ToolCallStatus,
  resultContent?: string,
): ToolCall {
  let args: Record<string, unknown> = {};
  if (acc.argsBuf) {
    try {
      args = JSON.parse(acc.argsBuf) as Record<string, unknown>;
    } catch {
      args = { _raw: acc.argsBuf };
    }
  }
  let result: unknown;
  if (resultContent !== undefined) {
    try {
      result = JSON.parse(resultContent);
    } catch {
      result = resultContent;
    }
  }
  return {
    id: acc.id,
    tool_id: acc.name,
    args,
    status,
    result,
  };
}
