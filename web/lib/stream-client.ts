/**
 * Unified SSE stream-client for agent / LLM output.
 *
 * Replaces the ad-hoc `fetch + getReader + split('\n')` logic that used to
 * live inline in chat and model-test surfaces.
 *
 * Contract (I-0015 / I-0016):
 *   - Parses `event: … \ndata: …\n\n` SSE frames.
 *   - Delivers `onToken` for the primary text delta event.
 *   - Delivers `onMetaEvent` for every other named event (tool_call_*,
 *     reasoning, confirm_required, trace, render, etc.).
 *   - Calls `onDone` once on stream completion (even if no done frame was
 *     emitted) and `onError` for transport or server errors.
 *   - Honors the caller-supplied `AbortSignal` and returns `{ abort }` so
 *     callers can also cancel without threading the controller.
 */

export type StreamEventFrame = {
  /** SSE `event:` name, or empty string when the stream used default event. */
  event: string;
  /** Parsed `data:` payload (JSON if decodable, otherwise `{_raw: string}`). */
  data: Record<string, unknown>;
};

export type StreamClientCallbacks = {
  /**
   * Token-bearing event. `frame.event` is the declared event name so callers
   * can distinguish e.g. `token` vs `reasoning`.
   */
  onToken?: (delta: string, frame: StreamEventFrame) => void;
  /** Every non-token event, including `done` / `error` / custom meta. */
  onMetaEvent?: (frame: StreamEventFrame) => void;
  /** Called once after the stream finishes cleanly. */
  onDone?: () => void;
  /** Called for transport errors, non-2xx HTTP, or consumer exceptions. */
  onError?: (err: Error) => void;
  /** External AbortSignal. The client also installs its own, returned via {abort}. */
  signal?: AbortSignal;
  /**
   * Which `event:` names count as token deltas, and which field holds the
   * text. Defaults cover the two known backends:
   *   - `/api/conversations/{id}/messages` emits `event: token` + `data.delta`
   *   - `/api/models/{id}/test/stream` emits `event: delta` + `data.text`
   *     (plus `event: reasoning` + `data.text` for thinking tokens).
   */
  tokenEvents?: Record<string, string>;
};

export type StreamHandle = {
  /** Aborts the underlying fetch + stops emitting callbacks. */
  abort: () => void;
  /** Resolves when the stream ends (done or aborted). Never rejects. */
  done: Promise<void>;
};

export type StreamRequestInit = Omit<RequestInit, "signal">;

const DEFAULT_TOKEN_EVENTS: Record<string, string> = {
  token: "delta",
  delta: "text",
  reasoning: "text",
};

export function openStream(
  url: string,
  init: StreamRequestInit,
  callbacks: StreamClientCallbacks,
): StreamHandle {
  const internal = new AbortController();
  const external = callbacks.signal;
  if (external) {
    if (external.aborted) internal.abort();
    else external.addEventListener("abort", () => internal.abort(), { once: true });
  }

  const tokenEvents = { ...DEFAULT_TOKEN_EVENTS, ...(callbacks.tokenEvents ?? {}) };

  const done = (async () => {
    let settled = false;
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

      try {
        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const rawFrame = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            const frame = parseSseFrame(rawFrame);
            if (!frame) continue;

            const tokenField = tokenEvents[frame.event];
            if (tokenField) {
              const delta = frame.data[tokenField];
              if (typeof delta === "string" && delta.length > 0) {
                callbacks.onToken?.(delta, frame);
              }
              callbacks.onMetaEvent?.(frame);
            } else {
              callbacks.onMetaEvent?.(frame);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      finish();
    } catch (err) {
      const e = err as Error;
      if (e?.name === "AbortError") {
        finish();
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

/**
 * Parses a single SSE frame. Multi-line `data:` lines are joined by `\n`
 * per the HTML spec. Returns `null` for empty frames (e.g. trailing
 * keep-alive newlines).
 */
export function parseSseFrame(frame: string): StreamEventFrame | null {
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
