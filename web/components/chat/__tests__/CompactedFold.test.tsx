import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@/tests/test-utils/i18n-render";
import { CompactedFold } from "../CompactedFold";
import type { Message } from "@/lib/protocol";

function makeMsg(over: Partial<Message>): Message {
  return {
    id: over.id ?? "m1",
    conversation_id: "c1",
    role: over.role ?? "user",
    content: over.content ?? "hello",
    tool_calls: [],
    render_payloads: [],
    created_at: "2026-04-28T00:00:00Z",
    is_compacted: true,
    ...over,
  };
}

describe("CompactedFold", () => {
  it("renders the heading with message count and stays collapsed by default", () => {
    render(
      <CompactedFold
        messages={[
          makeMsg({ id: "m1", content: "old1" }),
          makeMsg({ id: "m2", content: "old2", role: "assistant" }),
        ]}
      />,
    );
    const fold = screen.getByTestId("compacted-fold");
    expect(fold).toHaveAttribute("data-open", "false");
    expect(fold).toHaveAttribute("data-count", "2");
    expect(within(fold).getByText("2 条消息已压缩")).toBeInTheDocument();
    // Body not yet rendered.
    expect(screen.queryByTestId("compacted-message-m1")).not.toBeInTheDocument();
  });

  it("clicks expand the fold and reveals each message bubble", () => {
    render(
      <CompactedFold
        messages={[
          makeMsg({ id: "m1", content: "first" }),
          makeMsg({ id: "m2", content: "second", role: "assistant" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const fold = screen.getByTestId("compacted-fold");
    expect(fold).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("compacted-message-m1")).toBeInTheDocument();
    expect(screen.getByTestId("compacted-message-m2")).toBeInTheDocument();
  });

  it("returns null when the message list is empty", () => {
    const { container } = render(<CompactedFold messages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
