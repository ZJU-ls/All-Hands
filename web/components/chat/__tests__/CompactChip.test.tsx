import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@/tests/test-utils/i18n-render";
import { CompactChip } from "../CompactChip";
import { useChatStore } from "@/lib/store";
import type { CompactResult } from "@/lib/api";

const { compactMock } = vi.hoisted(() => ({
  compactMock: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    compactConversation: compactMock,
  };
});

function result(partial: Partial<CompactResult> = {}): CompactResult {
  return {
    dropped: 5,
    summary_id: "msg_summary",
    messages: [
      {
        id: "msg_summary",
        conversation_id: "conv_1",
        role: "system",
        content: "摘要",
        created_at: "2026-04-21T00:00:00Z",
      },
      {
        id: "msg_recent",
        conversation_id: "conv_1",
        role: "user",
        content: "hi",
        created_at: "2026-04-21T00:00:10Z",
      },
    ],
    ...partial,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  compactMock.mockReset();
  useChatStore.setState({ messages: [] });
});
afterEach(cleanup);

describe("CompactChip", () => {
  it("renders the idle label by default", () => {
    render(<CompactChip conversationId="conv_1" />);
    const chip = screen.getByTestId("compact-chip");
    expect(chip.getAttribute("data-state")).toBe("idle");
    expect(chip.textContent).toContain("压缩上下文");
  });

  it("posts to the compact endpoint and replaces store messages on success", async () => {
    compactMock.mockResolvedValue(result({ dropped: 7 }));
    render(<CompactChip conversationId="conv_1" />);
    fireEvent.click(screen.getByTestId("compact-chip"));
    await flush();
    expect(compactMock).toHaveBeenCalledWith("conv_1", undefined);
    const state = useChatStore.getState();
    expect(state.messages.length).toBe(2);
    expect(state.messages[0]?.id).toBe("msg_summary");
    const chip = screen.getByTestId("compact-chip");
    expect(chip.getAttribute("data-state")).toBe("done");
    expect(chip.textContent).toContain("7");
  });

  it("forwards the optional keep_last argument", async () => {
    compactMock.mockResolvedValue(result({ dropped: 1 }));
    render(<CompactChip conversationId="conv_1" keepLast={10} />);
    fireEvent.click(screen.getByTestId("compact-chip"));
    await flush();
    expect(compactMock).toHaveBeenCalledWith("conv_1", 10);
  });

  it("surfaces an error state when the request fails", async () => {
    compactMock.mockRejectedValue(new Error("boom"));
    render(<CompactChip conversationId="conv_1" />);
    fireEvent.click(screen.getByTestId("compact-chip"));
    await flush();
    const chip = screen.getByTestId("compact-chip");
    expect(chip.getAttribute("data-state")).toBe("error");
    expect(chip.getAttribute("title")).toContain("boom");
  });

  it("is non-interactive while disabled", () => {
    render(<CompactChip conversationId="conv_1" disabled />);
    fireEvent.click(screen.getByTestId("compact-chip"));
    expect(compactMock).not.toHaveBeenCalled();
  });
});
