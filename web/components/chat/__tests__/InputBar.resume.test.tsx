/**
 * InputBar · Phase 4e resume subscription (ADR 0014).
 *
 * When ConfirmationDialog publishes a pendingResumeRequest, InputBar must
 * open a /resume SSE with the decision payload and clear the request. This
 * pins the handoff so approvals for interrupt-sourced confirmations don't
 * silently sit (the worst possible failure mode — the user clicked approve
 * but the graph never resumed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

const openStreamMock =
  vi.fn<
    (input: string, init: RequestInit, handlers: unknown) => { abort: () => void }
  >();

vi.mock("@/lib/stream-client", () => ({
  openStream: (input: string, init: RequestInit, handlers: unknown) =>
    openStreamMock(input, init, handlers),
}));

// Stateful store mock — tracks pendingResumeRequest so the component's
// useEffect sees the change across renders.
const storeState: {
  pendingResumeRequest:
    | { conversationId: string; decision: "approve" | "reject" }
    | null;
} = { pendingResumeRequest: null };

const clearResumeRequestMock = vi.fn(() => {
  storeState.pendingResumeRequest = null;
});
const beginTurnMock = vi.fn();

vi.mock("@/lib/store", () => ({
  useChatStore: () => ({
    isStreaming: false,
    beginTurn: beginTurnMock,
    startStreaming: vi.fn(),
    appendToken: vi.fn(),
    appendReasoning: vi.fn(),
    updateToolCall: vi.fn(),
    addRenderPayload: vi.fn(),
    addConfirmation: vi.fn(),
    addMessage: vi.fn(),
    finalizeStreaming: vi.fn(),
    cancelStreaming: vi.fn(),
    setStreamError: vi.fn(),
    pendingResumeRequest: storeState.pendingResumeRequest,
    clearResumeRequest: clearResumeRequestMock,
  }),
}));

vi.mock("@/components/chat/ModelOverrideChip", () => ({
  ModelOverrideChip: () => null,
}));
vi.mock("@/components/chat/UsageChip", () => ({
  UsageChip: () => null,
}));
vi.mock("@/components/chat/CompactChip", () => ({
  CompactChip: () => null,
}));

import { InputBar } from "../InputBar";

beforeEach(() => {
  openStreamMock.mockReset();
  openStreamMock.mockReturnValue({ abort: vi.fn() });
  clearResumeRequestMock.mockClear();
  beginTurnMock.mockClear();
  storeState.pendingResumeRequest = null;
});

afterEach(() => {
  cleanup();
});

describe("InputBar · pendingResumeRequest → /resume SSE", () => {
  it("opens /resume SSE with decision body when request is present for this conversation", async () => {
    storeState.pendingResumeRequest = {
      conversationId: "conv-X",
      decision: "approve",
    };

    render(<InputBar conversationId="conv-X" />);

    await waitFor(() => expect(openStreamMock).toHaveBeenCalled());

    const call = openStreamMock.mock.calls[0]!;
    expect(call[0]).toContain("/api/conversations/conv-X/resume");
    const init = call[1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ resume_value: "approve" });

    // Must flip isStreaming so the bubble doesn't look frozen between
    // dialog close and the first continuation token.
    expect(beginTurnMock).toHaveBeenCalled();
    // Clears the request so re-renders don't double-fire the same decision.
    expect(clearResumeRequestMock).toHaveBeenCalled();
  });

  it("ignores resume request addressed to a different conversation", () => {
    storeState.pendingResumeRequest = {
      conversationId: "conv-OTHER",
      decision: "approve",
    };

    render(<InputBar conversationId="conv-MINE" />);

    // Different conv_id → this InputBar instance must not open the stream;
    // leaves the request intact for the matching instance to pick up.
    expect(openStreamMock).not.toHaveBeenCalled();
    expect(clearResumeRequestMock).not.toHaveBeenCalled();
  });

  it("passes reject through unchanged", async () => {
    storeState.pendingResumeRequest = {
      conversationId: "conv-X",
      decision: "reject",
    };

    render(<InputBar conversationId="conv-X" />);

    await waitFor(() => expect(openStreamMock).toHaveBeenCalled());
    const init = openStreamMock.mock.calls[0]![1];
    expect(JSON.parse(init.body as string)).toEqual({ resume_value: "reject" });
  });
});
