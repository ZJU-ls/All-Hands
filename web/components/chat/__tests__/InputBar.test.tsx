/**
 * InputBar · per-turn `thinking` body wire contract (E17 regression).
 *
 * Bug (2026-04-21): the composer always displayed the toggle state
 * correctly, but the POST body omitted the `thinking` key when the toggle
 * was OFF. `SendMessageRequest.thinking` then parsed as `None` on the
 * backend, which the runner read as "inherit provider default" — and
 * DashScope/Qwen3 defaults to `enable_thinking=true`. So the gray "深度
 * 思考" toggle meant "backend silently does what the provider decided",
 * not "don't think".
 *
 * Fix: always send the explicit boolean. Toggle OFF ⇒ `thinking: false`
 * in the body, which translates to `extra_body={"enable_thinking": false}`
 * on the model bind call and actually stops the reasoning stream.
 *
 * These tests pin the wire shape — if someone re-introduces
 * `if (thinking) body.thinking = true` the `false` assertion fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

const openStreamMock =
  vi.fn<
    (input: string, init: RequestInit, handlers: unknown) => { abort: () => void }
  >();

vi.mock("@/lib/stream-client", () => ({
  openStream: (input: string, init: RequestInit, handlers: unknown) =>
    openStreamMock(input, init, handlers),
}));

vi.mock("@/lib/store", () => {
  const state = {
    isStreaming: false,
  };
  return {
    useChatStore: () => ({
      isStreaming: state.isStreaming,
      beginTurn: vi.fn(),
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
    }),
  };
});

// ModelOverrideChip / UsageChip / CompactChip touch network or provider
// state; stub them out to keep the test focused on the POST body.
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
});

afterEach(() => {
  cleanup();
});

function parseBody(): Record<string, unknown> {
  expect(openStreamMock).toHaveBeenCalledTimes(1);
  const call = openStreamMock.mock.calls[0]!;
  const init = call[1];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("InputBar · thinking toggle wire contract (E17)", () => {
  it("POST body carries thinking: false when toggle is OFF (default)", () => {
    render(<InputBar conversationId="conv-1" />);
    const textarea = screen.getByTestId("composer-textarea");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("composer-send"));

    const body = parseBody();
    expect(body.content).toBe("hello");
    expect(body.thinking).toBe(false);
  });

  it("POST body carries thinking: true once toggle flips ON", () => {
    render(<InputBar conversationId="conv-1" />);
    fireEvent.click(screen.getByTestId("composer-thinking-toggle"));

    const textarea = screen.getByTestId("composer-textarea");
    fireEvent.change(textarea, { target: { value: "think about this" } });
    fireEvent.click(screen.getByTestId("composer-send"));

    const body = parseBody();
    expect(body.content).toBe("think about this");
    expect(body.thinking).toBe(true);
  });
});
