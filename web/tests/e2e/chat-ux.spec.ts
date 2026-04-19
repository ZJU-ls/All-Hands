import { test, expect, type Page } from "@playwright/test";

/**
 * I-0015 / I-0016 chat UX e2e.
 *
 * Flow under test:
 *   send → stream begins → button flips to stop
 *   typewriter: assistant text length grows across tokens
 *   click stop → stream aborts → composer returns to send → resend works
 *
 * Approach: install a page-level `fetch` mock via `addInitScript`. We push
 * SSE chunks on demand so we can pause mid-stream and verify that the
 * stop button actually cancels the fetch (Playwright's `route.fulfill`
 * completes the body synchronously so it can't be aborted mid-flight).
 */

const MOCK_SCRIPT = `
(() => {
  const state = { streams: new Map(), nextId: 1, openWaiters: [] };
  window.__chatMock = state;

  const encoder = new TextEncoder();
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const isChat = /\\/api\\/conversations\\/[^/]+\\/messages$/.test(url);
    const isHistory = /\\/api\\/conversations\\/[^/]+$/.test(url);
    const isEmployee = /\\/api\\/employees\\/[^/]+$/.test(url);

    if (isChat && init && init.method === 'POST') {
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

    if (isHistory && (!init || init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({
        id: url.split('/').pop(),
        employee_id: 'emp_lead',
        title: 'mock convo',
        created_at: new Date().toISOString(),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (isEmployee) {
      return new Response(JSON.stringify({
        id: 'emp_lead',
        name: 'Lead',
        description: 'mock',
        is_lead_agent: true,
        tool_ids: [],
        skill_ids: [],
        max_iterations: 10,
        model_ref: 'default',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (/\\/api\\/confirmations\\/pending$/.test(url)) {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return origFetch(input, init);
  };

  window.__chatMock_waitForOpen = () => new Promise((resolve) => { state.openWaiters.push(resolve); });
  window.__chatMock_push = (id, chunk) => {
    const e = state.streams.get(id);
    if (!e || e.aborted || e.closed) return;
    e.controller.enqueue(encoder.encode(chunk));
  };
  window.__chatMock_close = (id) => {
    const e = state.streams.get(id);
    if (!e || e.aborted || e.closed) return;
    e.closed = true;
    try { e.controller.close(); } catch (_) {}
  };
  window.__chatMock_aborted = (id) => {
    const e = state.streams.get(id);
    return !!(e && e.aborted);
  };
})();
`;

async function installMock(page: Page): Promise<void> {
  await page.addInitScript({ content: MOCK_SCRIPT });
}

async function waitForStream(page: Page, timeoutMs = 5000): Promise<number> {
  return await page.evaluate(async (ms) => {
    const w = window as unknown as {
      __chatMock_waitForOpen: () => Promise<number>;
    };
    return await Promise.race([
      w.__chatMock_waitForOpen(),
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
        __chatMock_push: (id: number, c: string) => void;
      };
      w.__chatMock_push(sid as number, c as string);
    },
    [id, chunk] as const,
  );
}

async function closeStream(page: Page, id: number): Promise<void> {
  await page.evaluate((sid) => {
    const w = window as unknown as { __chatMock_close: (id: number) => void };
    w.__chatMock_close(sid);
  }, id);
}

async function streamAborted(page: Page, id: number): Promise<boolean> {
  return await page.evaluate((sid) => {
    const w = window as unknown as {
      __chatMock_aborted: (id: number) => boolean;
    };
    return w.__chatMock_aborted(sid);
  }, id);
}

test.describe("chat UX · Composer send/stop + typewriter (I-0015 / I-0016)", () => {
  test("send → stop glyph → typewriter grows → abort → resend", async ({
    page,
  }) => {
    await installMock(page);
    await page.goto("/chat/conv-mock-1");

    const composer = page.getByTestId("composer");
    await expect(composer).toBeVisible();
    await expect(page.getByTestId("composer-send")).toBeVisible();
    await expect(page.getByTestId("composer-stop")).toHaveCount(0);

    const textarea = page.getByTestId("composer-textarea");
    await textarea.fill("hello");

    const open1 = waitForStream(page);
    await page.getByTestId("composer-send").click();
    const streamId1 = await open1;

    await pushChunk(
      page,
      streamId1,
      'event: token\ndata: {"message_id":"m_1","delta":"Hel"}\n\n',
    );

    await expect(page.getByTestId("composer-stop")).toBeVisible();
    await expect(page.getByTestId("composer-stop-glyph")).toBeVisible();
    await expect(page.getByTestId("composer-send")).toHaveCount(0);
    await expect(page.getByTestId("streaming-cursor")).toBeVisible();

    const assistantParagraph = page.locator("p.whitespace-pre-wrap").last();
    const len0 = ((await assistantParagraph.textContent()) ?? "").length;
    expect(len0).toBeGreaterThan(0);

    await pushChunk(
      page,
      streamId1,
      'event: token\ndata: {"message_id":"m_1","delta":"lo "}\n\n',
    );
    await expect
      .poll(
        async () => ((await assistantParagraph.textContent()) ?? "").length,
      )
      .toBeGreaterThan(len0);

    const len1 = ((await assistantParagraph.textContent()) ?? "").length;
    await pushChunk(
      page,
      streamId1,
      'event: token\ndata: {"message_id":"m_1","delta":"world"}\n\n',
    );
    await expect
      .poll(
        async () => ((await assistantParagraph.textContent()) ?? "").length,
      )
      .toBeGreaterThan(len1);

    await page.getByTestId("composer-stop").click();
    await expect(page.getByTestId("composer-send")).toBeVisible();
    await expect(page.getByTestId("streaming-cursor")).toHaveCount(0);
    expect(await streamAborted(page, streamId1)).toBe(true);

    await textarea.fill("again");
    const open2 = waitForStream(page);
    await page.getByTestId("composer-send").click();
    const streamId2 = await open2;
    expect(streamId2).not.toBe(streamId1);

    await pushChunk(
      page,
      streamId2,
      'event: token\ndata: {"message_id":"m_2","delta":"OK"}\n\n',
    );
    await expect(page.getByTestId("composer-stop")).toBeVisible();
    await expect(page.getByTestId("streaming-cursor")).toBeVisible();

    await pushChunk(
      page,
      streamId2,
      'event: done\ndata: {"message_id":"m_2"}\n\n',
    );
    await closeStream(page, streamId2);

    await expect(page.getByTestId("composer-send")).toBeVisible();
    await expect(page.getByTestId("streaming-cursor")).toHaveCount(0);
  });

  test("thinking toggle sits in the bottom control bar", async ({ page }) => {
    await installMock(page);
    await page.goto("/chat/conv-mock-2");
    const toggle = page.getByTestId("composer-thinking-toggle");
    await expect(toggle).toBeVisible();
    const textarea = page.getByTestId("composer-textarea");
    const toggleBox = await toggle.boundingBox();
    const taBox = await textarea.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(taBox).not.toBeNull();
    // Toggle must sit below the textarea — i.e. inside the ControlBar, not above.
    expect(toggleBox!.y).toBeGreaterThan(taBox!.y);
  });
});
