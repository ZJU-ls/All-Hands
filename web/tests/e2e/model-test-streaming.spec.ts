import { test, expect, type Page } from "@playwright/test";

/**
 * I-0018 regression · ModelTestDialog typewriter.
 *
 * Guards the fix in `stream-client.ts`: when the upstream packs multiple SSE
 * frames into ONE reader chunk (e.g. DashScope-compat endpoints with short
 * `max_tokens`), React 18 automatic batching used to collapse the resulting
 * setState calls into a single paint — the assistant text "蹦出一次" instead
 * of typewriter-streaming.
 *
 * The fix yields a macrotask between frames inside the stream-client drain
 * loop. This test proves the typewriter paints AT LEAST 5 distinct
 * intermediate states when 10 frames arrive in one chunk.
 */

const MOCK_SCRIPT = `
(() => {
  const state = { streams: new Map(), nextId: 1, openWaiters: [] };
  window.__modelTestMock = state;

  const encoder = new TextEncoder();
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (/\\/api\\/providers(?:\\?.*)?$/.test(url) && (!init || init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify([
        { id: 'prov-mock', name: 'mock', base_url: 'https://mock', api_key_set: true, default_model: 'mock-model', is_default: true, enabled: true },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (/\\/api\\/models(?:\\?.*)?$/.test(url) && (!init || init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify([
        { id: 'mdl-mock', provider_id: 'prov-mock', name: 'mock-model', display_name: 'Mock Model', context_window: 8192, enabled: true },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (/\\/api\\/models\\/[^/]+\\/test\\/stream$/.test(url) && init && init.method === 'POST') {
      const id = state.nextId++;
      const entry = { id, controller: null, aborted: false, closed: false };
      const signal = init.signal;
      const body = new ReadableStream({
        start(controller) {
          entry.controller = controller;
          if (signal) {
            if (signal.aborted) {
              entry.aborted = true;
              try { controller.error(Object.assign(new Error('aborted'), {name:'AbortError'})); } catch (_) {}
              return;
            }
            signal.addEventListener('abort', () => {
              entry.aborted = true;
              try { controller.error(Object.assign(new Error('aborted'), {name:'AbortError'})); } catch (_) {}
            }, { once: true });
          }
        },
      });
      state.streams.set(id, entry);
      const waiter = state.openWaiters.shift();
      if (waiter) waiter(id);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    return origFetch(input, init);
  };

  window.__modelTestMock_waitForOpen = () => new Promise((resolve) => { state.openWaiters.push(resolve); });
  window.__modelTestMock_push = (id, chunk) => {
    const e = state.streams.get(id);
    if (!e || e.aborted || e.closed) return;
    e.controller.enqueue(encoder.encode(chunk));
  };
  window.__modelTestMock_close = (id) => {
    const e = state.streams.get(id);
    if (!e || e.aborted || e.closed) return;
    e.closed = true;
    try { e.controller.close(); } catch (_) {}
  };
})();
`;

async function installMock(page: Page): Promise<void> {
  await page.addInitScript({ content: MOCK_SCRIPT });
}

async function waitForStream(page: Page, timeoutMs = 5000): Promise<number> {
  return await page.evaluate(async (ms) => {
    const w = window as unknown as {
      __modelTestMock_waitForOpen: () => Promise<number>;
    };
    return await Promise.race([
      w.__modelTestMock_waitForOpen(),
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("waitForOpen timeout")), ms),
      ),
    ]);
  }, timeoutMs);
}

async function pushChunk(page: Page, id: number, chunk: string): Promise<void> {
  await page.evaluate(
    ([sid, c]) => {
      const w = window as unknown as {
        __modelTestMock_push: (id: number, c: string) => void;
      };
      w.__modelTestMock_push(sid as number, c as string);
    },
    [id, chunk] as const,
  );
}

async function closeStream(page: Page, id: number): Promise<void> {
  await page.evaluate((sid) => {
    const w = window as unknown as {
      __modelTestMock_close: (id: number) => void;
    };
    w.__modelTestMock_close(sid);
  }, id);
}

test.describe("ModelTestDialog · typewriter with one-chunk SSE (I-0018)", () => {
  test("10 frames packed into one chunk still paint ≥5 distinct intermediate states", async ({
    page,
  }) => {
    await installMock(page);
    await page.goto("/gateway");

    await page.getByRole("button", { name: "对话测试" }).first().click();
    await expect(page.getByTestId("model-test-dialog")).toBeVisible();

    const composer = page.getByTestId("model-test-composer");
    await expect(composer).toBeVisible();
    const textarea = composer.locator("textarea");
    await textarea.fill("数 1 到 10");

    // Start observing assistant text BEFORE we fire the stream, so we can
    // capture every transient state. MutationObserver records the textContent
    // at every DOM mutation inside the transcript region.
    await page.evaluate(() => {
      const w = window as unknown as { __modelTestTextSeen?: Set<string> };
      w.__modelTestTextSeen = new Set<string>();
      const transcript = document.querySelector(
        '[data-testid="model-test-transcript"]',
      );
      if (!transcript) return;
      const observer = new MutationObserver(() => {
        const assistantBubble = transcript.querySelector(
          '[data-role="assistant"][data-streaming="true"]',
        );
        if (!assistantBubble) return;
        w.__modelTestTextSeen!.add(assistantBubble.textContent ?? "");
      });
      observer.observe(transcript, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });

    const openPromise = waitForStream(page);
    await page.getByTestId("composer-send").click();
    const streamId = await openPromise;

    // 10 delta frames, a-j, packed into a single enqueue → single reader chunk.
    // AG-UI v1 emits TEXT_MESSAGE_CHUNK per delta; this is the pathological
    // case the I-0018 macrotask fix has to survive.
    const deltas = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const preamble =
      'event: RUN_STARTED\ndata: {"threadId":"t_mt","runId":"r_mt"}\n\n' +
      'event: CUSTOM\ndata: {"name":"allhands.model_test_meta","value":{}}\n\n' +
      'event: TEXT_MESSAGE_START\ndata: {"threadId":"t_mt","runId":"r_mt","messageId":"m_mt","role":"assistant"}\n\n';
    const oneBigChunk =
      preamble +
      deltas
        .map(
          (t) =>
            `event: TEXT_MESSAGE_CHUNK\ndata: ${JSON.stringify({
              messageId: "m_mt",
              delta: t,
              role: "assistant",
            })}\n\n`,
        )
        .join("");
    await pushChunk(page, streamId, oneBigChunk);

    // Let React drain across macrotasks. Poll until we've observed a healthy
    // set of intermediate states, then finalize.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const w = window as unknown as {
              __modelTestTextSeen: Set<string>;
            };
            return w.__modelTestTextSeen.size;
          }),
        { timeout: 3000, intervals: [50, 100, 200] },
      )
      .toBeGreaterThanOrEqual(5);

    await pushChunk(
      page,
      streamId,
      `event: TEXT_MESSAGE_END\ndata: {"messageId":"m_mt"}\n\n` +
        `event: CUSTOM\ndata: ${JSON.stringify({
          name: "allhands.model_test_metrics",
          value: {
            response: deltas.join(""),
            latency_ms: 100,
            ttft_ms: 10,
            reasoning_first_ms: 0,
            usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
            tokens_per_second: 100,
          },
        })}\n\n` +
        `event: RUN_FINISHED\ndata: {"threadId":"t_mt","runId":"r_mt"}\n\n`,
    );
    await closeStream(page, streamId);

    await expect(page.getByTestId("model-test-metrics")).toBeVisible();
  });
});
