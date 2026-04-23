import { afterEach, describe, expect, it, vi } from "vitest";
import { openStream, parseSseFrame } from "../stream-client";

type FetchArgs = {
  url: string;
  init: RequestInit;
};

function mockStreamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function mockBlockingResponse(signal: AbortSignal): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const bail = () => {
        try {
          controller.error(
            Object.assign(new Error("aborted"), { name: "AbortError" }),
          );
        } catch {
          /* already closed */
        }
      };
      if (signal.aborted) {
        bail();
        return;
      }
      signal.addEventListener("abort", bail, { once: true });
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function installFetch(
  handler: (args: FetchArgs) => Response,
): {
  capture: FetchArgs | null;
  restore: () => void;
} {
  const original = globalThis.fetch;
  const capture: { current: FetchArgs | null } = { current: null };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const args: FetchArgs = {
      url: typeof input === "string" ? input : input.toString(),
      init: init ?? {},
    };
    capture.current = args;
    return handler(args);
  }) as typeof globalThis.fetch;

  return {
    get capture() {
      return capture.current;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe("parseSseFrame", () => {
  it("parses event + data pair", () => {
    expect(parseSseFrame('event: TEXT_MESSAGE_CONTENT\ndata: {"delta":"hi"}')).toEqual({
      event: "TEXT_MESSAGE_CONTENT",
      data: { delta: "hi" },
    });
  });

  it("joins multi-line data with newlines", () => {
    const frame = "event: TEXT_MESSAGE_CHUNK\ndata: line1\ndata: line2";
    const parsed = parseSseFrame(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.event).toBe("TEXT_MESSAGE_CHUNK");
    expect(parsed!.data._raw).toBe("line1\nline2");
  });

  it("returns null for empty frames", () => {
    expect(parseSseFrame("")).toBeNull();
    expect(parseSseFrame("\n\n")).toBeNull();
  });

  it("ignores comment lines starting with colon", () => {
    expect(parseSseFrame(": keep-alive\nevent: RUN_STARTED\ndata: {}")).toEqual({
      event: "RUN_STARTED",
      data: {},
    });
  });
});

describe("openStream · AG-UI v1 semantic hooks", () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("dispatches RUN_STARTED + TEXT_MESSAGE_* + RUN_FINISHED to typed hooks", async () => {
    const textDeltas: string[] = [];
    const events: string[] = [];
    const done = vi.fn();

    const fetchMock = installFetch(() =>
      mockStreamingResponse([
        'event: RUN_STARTED\ndata: {"threadId":"conv_1","runId":"run_abc"}\n\n',
        'event: TEXT_MESSAGE_START\ndata: {"messageId":"m1","role":"assistant"}\n\n',
        'event: TEXT_MESSAGE_CONTENT\ndata: {"messageId":"m1","delta":"he"}\n\n',
        'event: TEXT_MESSAGE_CONTENT\ndata: {"messageId":"m1","delta":"llo"}\n\n',
        'event: TEXT_MESSAGE_END\ndata: {"messageId":"m1"}\n\n',
        'event: RUN_FINISHED\ndata: {"threadId":"conv_1","runId":"run_abc"}\n\n',
      ]),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      {
        onRunStarted: (f) => events.push(`start:${f.threadId}:${f.runId}`),
        onTextMessageStart: (f) => events.push(`msg_start:${f.messageId}`),
        onTextMessageContent: (f) => {
          events.push("msg_content");
          textDeltas.push(f.delta);
        },
        onTextMessageEnd: (f) => events.push(`msg_end:${f.messageId}`),
        onRunFinished: (f) => events.push(`finished:${f.threadId}`),
        onDone: done,
      },
    );

    await handle.done;

    expect(events).toEqual([
      "start:conv_1:run_abc",
      "msg_start:m1",
      "msg_content",
      "msg_content",
      "msg_end:m1",
      "finished:conv_1",
    ]);
    expect(textDeltas).toEqual(["he", "llo"]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("routes REASONING_MESSAGE_CHUNK + TEXT_MESSAGE_CHUNK separately", async () => {
    const reasoning: string[] = [];
    const text: string[] = [];

    const fetchMock = installFetch(() =>
      mockStreamingResponse([
        'event: RUN_STARTED\ndata: {"threadId":"mt_1","runId":"run_1"}\n\n',
        'event: REASONING_MESSAGE_CHUNK\ndata: {"messageId":"r1","delta":"thinking..."}\n\n',
        'event: TEXT_MESSAGE_START\ndata: {"messageId":"m1","role":"assistant"}\n\n',
        'event: TEXT_MESSAGE_CHUNK\ndata: {"messageId":"m1","role":"assistant","delta":"answer"}\n\n',
        'event: TEXT_MESSAGE_END\ndata: {"messageId":"m1"}\n\n',
        'event: RUN_FINISHED\ndata: {"threadId":"mt_1","runId":"run_1"}\n\n',
      ]),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      {
        onReasoningMessageChunk: (f) => reasoning.push(f.delta),
        onTextMessageChunk: (f) => text.push(f.delta),
      },
    );

    await handle.done;

    expect(reasoning).toEqual(["thinking..."]);
    expect(text).toEqual(["answer"]);
  });

  it("dispatches TOOL_CALL_* lifecycle + CUSTOM envelopes", async () => {
    const toolEvents: string[] = [];
    const customs: Array<{ name: string; value: unknown }> = [];

    const fetchMock = installFetch(() =>
      mockStreamingResponse([
        'event: RUN_STARTED\ndata: {"threadId":"conv_1","runId":"run_1"}\n\n',
        'event: TOOL_CALL_START\ndata: {"toolCallId":"c1","toolCallName":"echo"}\n\n',
        'event: TOOL_CALL_ARGS\ndata: {"toolCallId":"c1","delta":"{\\"x\\":1}"}\n\n',
        'event: TOOL_CALL_END\ndata: {"toolCallId":"c1"}\n\n',
        'event: TOOL_CALL_RESULT\ndata: {"toolCallId":"c1","content":"{\\"ok\\":true}"}\n\n',
        'event: CUSTOM\ndata: {"name":"allhands.render","value":{"message_id":"m1","payload":{"component":"MarkdownCard","props":{"body":"hi"}}}}\n\n',
        'event: CUSTOM\ndata: {"name":"allhands.trace","value":{"trace_id":"tr_1","url":"https://lf/1"}}\n\n',
        'event: RUN_FINISHED\ndata: {"threadId":"conv_1","runId":"run_1"}\n\n',
      ]),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      {
        onToolCallStart: (f) => toolEvents.push(`start:${f.toolCallId}:${f.toolCallName}`),
        onToolCallArgs: (f) => toolEvents.push(`args:${f.delta}`),
        onToolCallEnd: (f) => toolEvents.push(`end:${f.toolCallId}`),
        onToolCallResult: (f) => toolEvents.push(`result:${f.content}`),
        onCustom: (name, value) => customs.push({ name, value }),
      },
    );

    await handle.done;

    expect(toolEvents).toEqual([
      "start:c1:echo",
      'args:{"x":1}',
      "end:c1",
      'result:{"ok":true}',
    ]);
    expect(customs.map((c) => c.name)).toEqual([
      "allhands.render",
      "allhands.trace",
    ]);
  });

  it("delivers allhands.interrupt_required CUSTOM with forwarded id + value (ADR 0014 Phase 3)", async () => {
    const customs: { name: string; value: unknown }[] = [];
    const fetchMock = installFetch(() =>
      mockStreamingResponse([
        'event: RUN_STARTED\ndata: {"threadId":"conv_1","runId":"run_1"}\n\n',
        'event: CUSTOM\ndata: {"name":"allhands.interrupt_required","value":{"interrupt_id":"itr_abc","value":{"kind":"confirm_required","summary":"Delete employee 42","rationale":"scope=WRITE"}}}\n\n',
        'event: RUN_FINISHED\ndata: {"threadId":"conv_1","runId":"run_1"}\n\n',
      ]),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      { onCustom: (name, value) => customs.push({ name, value }) },
    );
    await handle.done;

    // Backend → AG-UI encoder → transport → parser preserves both the
    // LangGraph interrupt_id (for resume) and the payload shape the agent
    // built for the prompt. If any of those drop, the UI can't match a
    // user decision back to the right pause.
    expect(customs).toHaveLength(1);
    expect(customs[0]?.name).toBe("allhands.interrupt_required");
    expect(customs[0]?.value).toEqual({
      interrupt_id: "itr_abc",
      value: {
        kind: "confirm_required",
        summary: "Delete employee 42",
        rationale: "scope=WRITE",
      },
    });
  });

  it("surfaces RUN_ERROR to onRunError (not onError)", async () => {
    const onRunError = vi.fn();
    const onError = vi.fn();
    const onDone = vi.fn();

    const fetchMock = installFetch(() =>
      mockStreamingResponse([
        'event: RUN_STARTED\ndata: {"threadId":"conv_1","runId":"run_1"}\n\n',
        'event: RUN_ERROR\ndata: {"message":"rate limited","code":"RATE_LIMIT"}\n\n',
      ]),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      { onRunError, onError, onDone },
    );
    await handle.done;

    expect(onRunError).toHaveBeenCalledWith({
      message: "rate limited",
      code: "RATE_LIMIT",
    });
    expect(onError).not.toHaveBeenCalled();
    // Stream ended cleanly even though the run errored.
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("surfaces non-2xx HTTP via onError", async () => {
    const onError = vi.fn();

    const fetchMock = installFetch(
      () => new Response("boom", { status: 500 }),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      { onError },
    );

    await handle.done;
    expect(onError).toHaveBeenCalledOnce();
    const err = onError.mock.calls[0]?.[0] as Error;
    expect(err?.message ?? "").toContain("HTTP 500");
  });

  it("abort() closes the stream without calling onError", async () => {
    const onError = vi.fn();
    const onDone = vi.fn();
    const fetchMock = installFetch(
      (args) => mockBlockingResponse((args.init.signal as AbortSignal)!),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      { onError, onDone },
    );
    await Promise.resolve();
    handle.abort();
    await handle.done;

    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it(
    "spreads frame dispatch across macrotasks when frames arrive in one chunk (I-0018)",
    async () => {
      // All 5 frames arrive in a SINGLE reader.read() chunk — mirroring the
      // pathological upstream-batching case. The fix is to yield a macrotask
      // between frames so React 18 can paint between setState calls.
      const fetchMock = installFetch(() =>
        mockStreamingResponse([
          [
            'event: RUN_STARTED\ndata: {"threadId":"t","runId":"r"}\n\n',
            'event: TEXT_MESSAGE_CHUNK\ndata: {"messageId":"m","role":"assistant","delta":"a"}\n\n',
            'event: TEXT_MESSAGE_CHUNK\ndata: {"messageId":"m","role":"assistant","delta":"b"}\n\n',
            'event: TEXT_MESSAGE_CHUNK\ndata: {"messageId":"m","role":"assistant","delta":"c"}\n\n',
            'event: TEXT_MESSAGE_CHUNK\ndata: {"messageId":"m","role":"assistant","delta":"d"}\n\n',
            'event: TEXT_MESSAGE_CHUNK\ndata: {"messageId":"m","role":"assistant","delta":"e"}\n\n',
          ].join(""),
        ]),
      );
      restore = fetchMock.restore;

      let markerFired = false;
      setTimeout(() => {
        markerFired = true;
      }, 0);

      const before: string[] = [];
      const after: string[] = [];

      const handle = openStream(
        "/api/stream",
        { method: "POST" },
        {
          onTextMessageChunk: (f) => {
            (markerFired ? after : before).push(f.delta);
          },
        },
      );

      await handle.done;

      expect(before.length + after.length).toBe(5);
      expect(after.length).toBeGreaterThan(0);
    },
  );

  it("honors an external AbortSignal that is already aborted", async () => {
    const onDone = vi.fn();
    const onError = vi.fn();
    const controller = new AbortController();
    controller.abort();

    const fetchMock = installFetch(
      (args) => mockBlockingResponse((args.init.signal as AbortSignal)!),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      { signal: controller.signal, onDone, onError },
    );
    await handle.done;

    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("dispatches STEP_STARTED / STEP_FINISHED for nested-run markers", async () => {
    const steps: string[] = [];

    const fetchMock = installFetch(() =>
      mockStreamingResponse([
        'event: RUN_STARTED\ndata: {"threadId":"conv_1","runId":"run_1"}\n\n',
        'event: STEP_STARTED\ndata: {"stepName":"nested_run.hr_agent"}\n\n',
        'event: STEP_FINISHED\ndata: {"stepName":"nested_run.hr_agent"}\n\n',
        'event: RUN_FINISHED\ndata: {"threadId":"conv_1","runId":"run_1"}\n\n',
      ]),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      {
        onStepStarted: (f) => steps.push(`start:${f.stepName}`),
        onStepFinished: (f) => steps.push(`end:${f.stepName}`),
      },
    );
    await handle.done;

    expect(steps).toEqual([
      "start:nested_run.hr_agent",
      "end:nested_run.hr_agent",
    ]);
  });
});
