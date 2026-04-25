import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@/tests/test-utils/i18n-render";
import type { AgUiCallbacks, StreamHandle } from "@/lib/stream-client";
import { ModelTestDialog } from "../ModelTestDialog";

// jsdom doesn't implement Element.prototype.scrollTo; the dialog's stick-to-
// bottom effect calls it on mount. Stub to no-op so render() doesn't throw.
if (typeof Element !== "undefined" && !("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: () => {},
  });
}

// Hoisted holders so `vi.mock` can reach them — mocks are lifted above imports.
const { openStreamMock, captured } = vi.hoisted(() => ({
  openStreamMock: vi.fn(),
  captured: { callbacks: null as AgUiCallbacks | null, handle: null as StreamHandle | null },
}));

vi.mock("@/lib/stream-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stream-client")>(
    "@/lib/stream-client",
  );
  return {
    ...actual,
    openStream: openStreamMock,
  };
});

function makeHandle(): StreamHandle {
  return { abort: vi.fn(), done: Promise.resolve() };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function sendPrompt(text = "hi"): Promise<void> {
  const textarea = screen.getByPlaceholderText("输入消息...");
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter" });
  await flush();
}

afterEach(() => {
  cleanup();
  openStreamMock.mockReset();
  captured.callbacks = null;
  captured.handle = null;
  vi.useRealTimers();
});

beforeEach(() => {
  openStreamMock.mockImplementation(
    (_url: string, _init: unknown, callbacks: AgUiCallbacks) => {
      captured.callbacks = callbacks;
      const handle = makeHandle();
      captured.handle = handle;
      return handle;
    },
  );
});

describe("ModelTestDialog · thinking placeholder", () => {
  it("shows the thinking placeholder between send and first chunk", async () => {
    render(
      <ModelTestDialog
        model={{ id: "m1", name: "qwen3", display_name: "Qwen3" }}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByTestId("model-test-thinking")).toBeNull();

    await sendPrompt();

    expect(screen.getByTestId("model-test-thinking")).toBeInTheDocument();
    expect(screen.getByText("正在处理请求")).toBeInTheDocument();
  });

  it("hides the placeholder once the first reasoning chunk arrives", async () => {
    render(
      <ModelTestDialog
        model={{ id: "m1", name: "qwen3", display_name: "Qwen3" }}
        onClose={() => {}}
      />,
    );
    await sendPrompt();
    expect(screen.getByTestId("model-test-thinking")).toBeInTheDocument();

    await act(async () => {
      captured.callbacks?.onReasoningMessageChunk?.({
        messageId: "m",
        delta: "开始思考…",
      });
    });

    expect(screen.queryByTestId("model-test-thinking")).toBeNull();
    // Reasoning panel appears instead. Its body (rendered via AgentMarkdown)
    // hydrates asynchronously from a dynamic import, so assert the container.
    expect(screen.getByTestId("model-test-reasoning")).toBeInTheDocument();
  });

  it("hides the placeholder once the first text chunk arrives", async () => {
    render(
      <ModelTestDialog
        model={{ id: "m1", name: "gpt-4o-mini", display_name: "GPT-4o mini" }}
        onClose={() => {}}
      />,
    );
    await sendPrompt();
    expect(screen.getByTestId("model-test-thinking")).toBeInTheDocument();

    await act(async () => {
      captured.callbacks?.onTextMessageChunk?.({
        messageId: "m",
        delta: "Hello",
      });
    });

    expect(screen.queryByTestId("model-test-thinking")).toBeNull();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("surfaces the elapsed counter after 1s of silence", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <ModelTestDialog
        model={{ id: "m1", name: "qwen3", display_name: "Qwen3" }}
        onClose={() => {}}
      />,
    );
    await sendPrompt();
    const placeholder = screen.getByTestId("model-test-thinking");
    // < 1s: no elapsed counter yet (noisy for fast models)
    expect(placeholder.textContent ?? "").not.toMatch(/\ds/);

    await act(async () => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.getByTestId("model-test-thinking").textContent ?? "").toMatch(
      /1\.[234]s/,
    );
  });
});
