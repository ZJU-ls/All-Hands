import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@/tests/test-utils/i18n-render";
import { MessageBubble } from "../MessageBubble";
import type { Message } from "@/lib/protocol";

afterEach(cleanup);

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    conversation_id: "conv_1",
    role: "assistant",
    content: "",
    tool_calls: [],
    render_payloads: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("MessageBubble streaming cursor", () => {
  it("shows cursor when streaming an assistant message, even with partial content", () => {
    render(
      <MessageBubble message={makeMessage({ content: "hel" })} isStreaming />,
    );
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
    expect(screen.getByTestId("streaming-cursor").textContent).toBe("▍");
  });

  it("shows cursor even when content is empty (pre-first-token)", () => {
    render(<MessageBubble message={makeMessage({ content: "" })} isStreaming />);
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
  });

  it("hides cursor once streaming ends", () => {
    render(
      <MessageBubble
        message={makeMessage({ content: "final answer" })}
        isStreaming={false}
      />,
    );
    expect(screen.queryByTestId("streaming-cursor")).toBeNull();
  });

  it("never shows cursor on a user message", () => {
    render(
      <MessageBubble
        message={makeMessage({ role: "user", content: "hi" })}
        isStreaming
      />,
    );
    expect(screen.queryByTestId("streaming-cursor")).toBeNull();
  });
});

describe("MessageBubble segment interleaving", () => {
  // AgentMarkdown dynamic-imports `marked` and renders asynchronously — its
  // text isn't synchronously in the DOM at test time. So we assert on the
  // outer structural ordering instead: how many tool cards / render slots
  // are rendered and in what DOM order. AgentMarkdown's *own* content
  // rendering is covered by its own tests.
  function collectOrder(container: HTMLElement): string[] {
    const order: string[] = [];
    const candidates = container.querySelectorAll(
      '[data-testid="agent-markdown"], [data-testid="tool-call-card"], [data-testid="system-tool-line"], [data-testid="render-slot-unknown"], [data-testid="render-slot-crash"]',
    );
    candidates.forEach((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      if (id === "agent-markdown") order.push("text");
      else if (id === "tool-call-card" || id === "system-tool-line") order.push("tool");
      else order.push("render");
    });
    return order;
  }

  it("renders text → render → text → render in stream order, not bucketed", () => {
    const msg = makeMessage({
      content: "先展示一个表:\n\n然后展示一个图:",
      tool_calls: [
        {
          id: "c1",
          tool_id: "allhands.render.table",
          args: {},
          status: "succeeded",
          result: { component: "Viz.Table" },
        },
        {
          id: "c2",
          tool_id: "allhands.render.bar_chart",
          args: {},
          status: "succeeded",
          result: { component: "Viz.BarChart" },
        },
      ],
      render_payloads: [
        { component: "Viz.Table", props: { columns: [], rows: [] }, interactions: [] },
        { component: "Viz.BarChart", props: { bars: [{ label: "A", value: 1 }] }, interactions: [] },
      ],
      segments: [
        { kind: "text", content: "先展示一个表:\n\n" },
        { kind: "tool_call", tool_call_id: "c1" },
        { kind: "render", index: 0 },
        { kind: "text", content: "然后展示一个图:" },
        { kind: "tool_call", tool_call_id: "c2" },
        { kind: "render", index: 1 },
      ],
    });
    const { container } = render(<MessageBubble message={msg} />);
    // Render tool cards are suppressed — we should see zero ToolCallCard
    // nodes even though there are two tool_calls in the message.
    expect(container.querySelectorAll('[data-testid="tool-call-card"]').length).toBe(0);
    // Two render slots present, in stream order
    expect(collectOrder(container)).toEqual(["text", "render", "text", "render"]);
  });

  it("renders system-tool meta calls as an inline SystemToolLine (P13)", () => {
    const msg = makeMessage({
      content: "Looking up providers.",
      tool_calls: [
        {
          id: "m1",
          tool_id: "allhands.meta.list_providers",
          args: {},
          status: "succeeded",
          result: { providers: [{}, {}], count: 2 },
        },
      ],
      render_payloads: [],
      segments: [
        { kind: "text", content: "Looking up providers.\n" },
        { kind: "tool_call", tool_call_id: "m1" },
      ],
    });
    const { container } = render(<MessageBubble message={msg} />);
    // System tools use the inline pill, not the expandable card.
    expect(screen.queryByTestId("tool-call-card")).toBeNull();
    expect(screen.getByTestId("system-tool-line")).toHaveAttribute(
      "data-tool-id",
      "allhands.meta.list_providers",
    );
    expect(collectOrder(container)).toEqual(["text", "tool"]);
  });

  it("routes external (mcp.*) tools to the expandable ToolCallCard", () => {
    const msg = makeMessage({
      content: "Reading filesystem.",
      tool_calls: [
        {
          id: "x1",
          tool_id: "mcp.Filesystem.read_file",
          args: { path: "/tmp/x" },
          status: "succeeded",
          result: { result: "hello" },
        },
      ],
      render_payloads: [],
      segments: [
        { kind: "text", content: "Reading filesystem.\n" },
        { kind: "tool_call", tool_call_id: "x1" },
      ],
    });
    render(<MessageBubble message={msg} />);
    expect(screen.queryByTestId("system-tool-line")).toBeNull();
    expect(screen.getByTestId("tool-call-card")).toBeDefined();
  });

  it("falls back to legacy bucketed layout when segments absent", () => {
    // Historical message loaded from DB — no segments field.
    const msg = makeMessage({
      content: "history msg",
      tool_calls: [],
      render_payloads: [],
    });
    const { container } = render(<MessageBubble message={msg} />);
    // Exactly one text block (AgentMarkdown) rendered — the legacy path is
    // active and doesn't emit any tool/render slots.
    expect(collectOrder(container)).toEqual(["text"]);
  });

  it("legacy path still hides render-tool cards", () => {
    const msg = makeMessage({
      content: "done",
      tool_calls: [
        {
          id: "c1",
          tool_id: "allhands.render.table",
          args: {},
          status: "succeeded",
          result: { component: "Viz.Table" },
        },
      ],
      render_payloads: [
        { component: "Viz.Table", props: { columns: [], rows: [] }, interactions: [] },
      ],
      // No segments — legacy fallback.
    });
    const { container } = render(<MessageBubble message={msg} />);
    expect(container.querySelectorAll('[data-testid="tool-call-card"]').length).toBe(0);
  });
});
