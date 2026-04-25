/**
 * AG-UI Protocol v1 SSE client (I-0017 · ADR 0010).
 *
 * Parses `event: <TYPE>\ndata: <JSON>\n\n` frames emitted by the four
 * streaming endpoints (chat · model-test · cockpit · artifacts) and
 * dispatches them to typed semantic callbacks. Wire fields are camelCase
 * per AG-UI v1; private allhands payloads ride inside CUSTOM envelopes
 * with `name: "allhands.*"` and a snake_case `value` body.
 *
 * Cancellation (I-0015 / I-0016): honors the caller's AbortSignal and
 * returns {abort} so surfaces can cancel without threading the controller.
 */
export type AgUiEventFrame = {
  /** AG-UI event type (RUN_STARTED, TEXT_MESSAGE_CONTENT, CUSTOM, …). */
  event: string;
  /** Parsed JSON data line (or `{_raw: "..."}` for non-JSON data). */
  data: Record<string, unknown>;
};

export type RunStartedFrame = { threadId: string; runId: string };
export type RunFinishedFrame = { threadId: string; runId: string };
export type RunErrorFrame = { message: string; code?: string };
export type TextMessageStartFrame = { messageId: string; role: string };
export type TextMessageDeltaFrame = { messageId: string; delta: string; role?: string };
export type TextMessageEndFrame = { messageId: string };
export type ReasoningMessageChunkFrame = { messageId: string; delta: string };
export type ReasoningMessageEndFrame = { messageId: string };
export type ToolCallStartFrame = { toolCallId: string; toolCallName: string };
export type ToolCallArgsFrame = { toolCallId: string; delta: string };
export type ToolCallEndFrame = { toolCallId: string };
export type ToolCallResultFrame = { toolCallId: string; content: string };
export type StepFrame = { stepName: string };

export type AgUiCallbacks = {
  onRunStarted?: (frame: RunStartedFrame) => void;
  onRunFinished?: (frame: RunFinishedFrame) => void;
  onRunError?: (frame: RunErrorFrame) => void;

  onTextMessageStart?: (frame: TextMessageStartFrame) => void;
  onTextMessageContent?: (frame: TextMessageDeltaFrame) => void;
  onTextMessageChunk?: (frame: TextMessageDeltaFrame) => void;
  onTextMessageEnd?: (frame: TextMessageEndFrame) => void;

  onReasoningMessageChunk?: (frame: ReasoningMessageChunkFrame) => void;
  onReasoningMessageEnd?: (frame: ReasoningMessageEndFrame) => void;

  onToolCallStart?: (frame: ToolCallStartFrame) => void;
  onToolCallArgs?: (frame: ToolCallArgsFrame) => void;
  onToolCallEnd?: (frame: ToolCallEndFrame) => void;
  onToolCallResult?: (frame: ToolCallResultFrame) => void;

  onStepStarted?: (frame: StepFrame) => void;
  onStepFinished?: (frame: StepFrame) => void;

  /**
   * CUSTOM envelope — `name` identifies the extension (e.g.
   * `allhands.confirm_required`), `value` is the snake_case payload.
   */
  onCustom?: (name: string, value: unknown, frame: AgUiEventFrame) => void;

  /** Any AG-UI event that isn't covered by a typed handler above. */
  onEvent?: (frame: AgUiEventFrame) => void;

  /** Called once when the stream terminates cleanly (RUN_FINISHED, EOF, or abort). */
  onDone?: () => void;
  /** Called for transport errors, non-2xx HTTP, or consumer exceptions. */
  onError?: (err: Error) => void;

  signal?: AbortSignal;
};

export type StreamHandle = {
  /** Aborts the underlying fetch + stops emitting callbacks. */
  abort: () => void;
  /** Resolves when the stream ends (done or aborted). Never rejects. */
  done: Promise<void>;
};

export type StreamRequestInit = Omit<RequestInit, "signal">;

export function openStream(
  url: string,
  init: StreamRequestInit,
  callbacks: AgUiCallbacks,
): StreamHandle {
  const internal = new AbortController();
  const external = callbacks.signal;
  if (external) {
    if (external.aborted) internal.abort();
    else external.addEventListener("abort", () => internal.abort(), { once: true });
  }

  const done = (async () => {
    let settled = false;
    let watchdogTripped = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) callbacks.onError?.(err);
      else callbacks.onDone?.();
    };

    try {
      const res = await fetch(url, { ...init, signal: internal.signal });
      if (!res.ok) {
        throw new Error(`stream-client: HTTP ${res.status} ${res.statusText}`);
      }
      if (!res.body) {
        finish();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // 2026-04-25 · transport watchdog. The server pumps a CUSTOM
      // ``allhands.heartbeat`` every 10s of agent-side silence; if the TCP
      // stays open but no frame arrives for 60s, both sides have
      // effectively disconnected (proxy / browser / network). Abort the
      // fetch so isStreaming flips false and the UI escapes the永远转圈.
      // Reset on every reader.read() that returns bytes.
      const SILENT_TIMEOUT_MS = 60_000;
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      const armWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          // Mark the abort as watchdog-originated so the outer catch
          // raises onError instead of silently completing the run. User-
          // initiated aborts (the stop button) leave watchdogTripped=false
          // and still finish cleanly.
          watchdogTripped = true;
          internal.abort();
        }, SILENT_TIMEOUT_MS);
      };
      armWatchdog();

      try {
        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          armWatchdog();
          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const rawFrame = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            const frame = parseSseFrame(rawFrame);
            if (!frame) continue;

            dispatchFrame(frame, callbacks);

            // I-0018: yield a macrotask between frames so React 18 can paint
            // between setState calls. Without this, when upstream packs
            // multiple frames into a single reader chunk (common for
            // DashScope-family compat endpoints with max_tokens <= 64) the
            // drain loop fires N synchronous setState callbacks in one task,
            // automatic batching collapses them into a single paint, and the
            // assistant text appears to "蹦出一次".
            if (internal.signal.aborted) break;
            await new Promise<void>((r) => setTimeout(r, 0));
          }
        }
      } finally {
        if (watchdog) clearTimeout(watchdog);
        reader.releaseLock();
      }

      finish();
    } catch (err) {
      const e = err as Error;
      if (e?.name === "AbortError") {
        if (watchdogTripped) {
          finish(new Error("stream-client: idle for 60s · server not responding"));
        } else {
          finish();
        }
        return;
      }
      finish(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return {
    abort: () => internal.abort(),
    done,
  };
}

function dispatchFrame(frame: AgUiEventFrame, cb: AgUiCallbacks): void {
  const d = frame.data;
  switch (frame.event) {
    case "RUN_STARTED":
      cb.onRunStarted?.({
        threadId: String(d.threadId ?? ""),
        runId: String(d.runId ?? ""),
      });
      return;
    case "RUN_FINISHED":
      cb.onRunFinished?.({
        threadId: String(d.threadId ?? ""),
        runId: String(d.runId ?? ""),
      });
      return;
    case "RUN_ERROR":
      cb.onRunError?.({
        message: String(d.message ?? ""),
        code: typeof d.code === "string" ? d.code : undefined,
      });
      return;

    case "TEXT_MESSAGE_START":
      cb.onTextMessageStart?.({
        messageId: String(d.messageId ?? ""),
        role: String(d.role ?? "assistant"),
      });
      return;
    case "TEXT_MESSAGE_CONTENT":
      cb.onTextMessageContent?.({
        messageId: String(d.messageId ?? ""),
        delta: String(d.delta ?? ""),
      });
      return;
    case "TEXT_MESSAGE_CHUNK":
      cb.onTextMessageChunk?.({
        messageId: String(d.messageId ?? ""),
        delta: String(d.delta ?? ""),
        role: typeof d.role === "string" ? d.role : "assistant",
      });
      return;
    case "TEXT_MESSAGE_END":
      cb.onTextMessageEnd?.({ messageId: String(d.messageId ?? "") });
      return;

    case "REASONING_MESSAGE_CHUNK":
      cb.onReasoningMessageChunk?.({
        messageId: String(d.messageId ?? ""),
        delta: String(d.delta ?? ""),
      });
      return;
    case "REASONING_MESSAGE_END":
      cb.onReasoningMessageEnd?.({ messageId: String(d.messageId ?? "") });
      return;

    case "TOOL_CALL_START":
      cb.onToolCallStart?.({
        toolCallId: String(d.toolCallId ?? ""),
        toolCallName: String(d.toolCallName ?? ""),
      });
      return;
    case "TOOL_CALL_ARGS":
      cb.onToolCallArgs?.({
        toolCallId: String(d.toolCallId ?? ""),
        delta: String(d.delta ?? ""),
      });
      return;
    case "TOOL_CALL_END":
      cb.onToolCallEnd?.({ toolCallId: String(d.toolCallId ?? "") });
      return;
    case "TOOL_CALL_RESULT":
      cb.onToolCallResult?.({
        toolCallId: String(d.toolCallId ?? ""),
        content: String(d.content ?? ""),
      });
      return;

    case "STEP_STARTED":
      cb.onStepStarted?.({ stepName: String(d.stepName ?? "") });
      return;
    case "STEP_FINISHED":
      cb.onStepFinished?.({ stepName: String(d.stepName ?? "") });
      return;

    case "CUSTOM": {
      const name = typeof d.name === "string" ? d.name : "";
      cb.onCustom?.(name, d.value, frame);
      return;
    }

    default:
      cb.onEvent?.(frame);
  }
}

/**
 * Parses a single SSE frame. Multi-line `data:` lines are joined by `\n`
 * per the HTML spec. Returns `null` for empty frames (e.g. trailing
 * keep-alive newlines).
 */
export function parseSseFrame(frame: string): AgUiEventFrame | null {
  let event = "";
  const dataParts: string[] = [];
  let hasContent = false;

  for (const line of frame.split("\n")) {
    if (!line) continue;
    hasContent = true;
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }

  if (!hasContent) return null;
  const raw = dataParts.join("\n");
  if (!raw) return { event, data: {} };

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { event, data: parsed };
  } catch {
    return { event, data: { _raw: raw } };
  }
}

/**
 * Parses a raw `MessageEvent.data` from an EventSource-style consumer into a
 * JSON object. Used by the cockpit + artifacts stream consumers that use
 * the browser `EventSource` (not `openStream`) — they only need the JSON
 * body of the frame since the event type lands via `addEventListener`.
 */
export function parseAgUiMessageData(data: string): Record<string, unknown> | null {
  if (!data) return null;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}
