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
      // Never emit. Only close when aborted.
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
    expect(parseSseFrame("event: token\ndata: {\"delta\":\"hi\"}")).toEqual({
      event: "token",
      data: { delta: "hi" },
    });
  });

  it("joins multi-line data with newlines", () => {
    const frame = "event: delta\ndata: line1\ndata: line2";
    const parsed = parseSseFrame(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.event).toBe("delta");
    // Multi-line data that isn't JSON is wrapped as _raw.
    expect(parsed!.data._raw).toBe("line1\nline2");
  });

  it("returns null for empty frames", () => {
    expect(parseSseFrame("")).toBeNull();
    expect(parseSseFrame("\n\n")).toBeNull();
  });

  it("ignores comment lines starting with colon", () => {
    expect(parseSseFrame(": keep-alive\nevent: ping\ndata: {}")).toEqual({
      event: "ping",
      data: {},
    });
  });
});

describe("openStream", () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("delivers tokens then done in order", async () => {
    const tokens: string[] = [];
    const meta: string[] = [];
    const done = vi.fn();

    const fetchMock = installFetch(() =>
      mockStreamingResponse([
        "event: token\ndata: {\"message_id\":\"m1\",\"delta\":\"he\"}\n\n",
        "event: token\ndata: {\"message_id\":\"m1\",\"delta\":\"llo\"}\n\n",
        "event: done\ndata: {\"message_id\":\"m1\",\"reason\":\"done\"}\n\n",
      ]),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      {
        onToken: (delta) => tokens.push(delta),
        onMetaEvent: (frame) => meta.push(frame.event),
        onDone: done,
      },
    );

    await handle.done;

    expect(tokens).toEqual(["he", "llo"]);
    expect(meta).toEqual(["token", "token", "done"]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("routes reasoning-style events via the tokenEvents map", async () => {
    const tokens: Array<[string, string]> = [];

    const fetchMock = installFetch(() =>
      mockStreamingResponse([
        "event: reasoning\ndata: {\"text\":\"thinking...\"}\n\n",
        "event: delta\ndata: {\"text\":\"answer\"}\n\n",
        "event: done\ndata: {}\n\n",
      ]),
    );
    restore = fetchMock.restore;

    const handle = openStream(
      "/api/stream",
      { method: "POST" },
      {
        tokenEvents: { delta: "text", reasoning: "text" },
        onToken: (delta, frame) => tokens.push([frame.event, delta]),
      },
    );

    await handle.done;

    expect(tokens).toEqual([
      ["reasoning", "thinking..."],
      ["delta", "answer"],
    ]);
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
    // Kick the event loop so fetch resolves and reader starts awaiting.
    await Promise.resolve();
    handle.abort();
    await handle.done;

    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

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
});
