import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
