/**
 * UsageChip — Track ε context accounting + compaction button.
 *
 * Covers:
 *   - Tier class switching at 70% / 90% thresholds
 *   - 整理 button hidden below warn threshold, shown at/above it
 *   - Compaction calls POST /compact and replaces store messages
 *     with the returned list
 *   - Falls back to 128k context window when the ref can't be resolved
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { UsageChip } from "../UsageChip";
import { useChatStore } from "@/lib/store";
import type { Message } from "@/lib/protocol";

const providers = [
  {
    id: "p1",
    name: "OpenRouter",
    kind: "openai" as const,
    base_url: "https://openrouter.ai",
    default_model: "gpt-4o-mini",
    is_default: true,
    enabled: true,
  },
];

const models = [
  {
    id: "m1",
    provider_id: "p1",
    name: "gpt-4o-mini",
    display_name: "GPT 4o Mini",
    context_window: 100,
    enabled: true,
  },
];

function makeMessage(id: string, content: string): Message {
  return {
    id,
    conversation_id: "conv-1",
    role: "user",
    content,
    tool_calls: [],
    render_payloads: [],
    created_at: new Date().toISOString(),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/api/providers")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(providers),
      } as Response);
    }
    if (url.endsWith("/api/models")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(models),
      } as Response);
    }
    if (url.endsWith("/compact") && init?.method === "POST") {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            dropped: 4,
            summary_id: "sum-1",
            messages: [
              {
                id: "sum-1",
                conversation_id: "conv-1",
                role: "system",
                content: "[系统] 已压缩 4 条较早消息以节省上下文。",
                created_at: new Date().toISOString(),
              },
            ],
          }),
      } as Response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  useChatStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useChatStore.getState().reset();
});

async function flush() {
  // Two microtask flushes: one for listProviders/listModels, one for state.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("UsageChip", () => {
  it("renders 'ok' tier with no compact button when well under threshold", async () => {
    // window=100 tokens, chars/4 heuristic: 40 chars -> 10 tokens (10%).
    useChatStore.getState().addMessage(makeMessage("m1", "a".repeat(40)));

    render(
      <UsageChip conversationId="conv-1" employeeModelRef="OpenRouter/gpt-4o-mini" />,
    );
    await flush();

    const chip = screen.getByTestId("usage-chip");
    expect(chip.getAttribute("data-tier")).toBe("ok");
    expect(screen.queryByTestId("usage-chip-compact")).toBeNull();
    // 10 tokens used / 100 window
    expect(chip.textContent).toContain("10");
  });

  it("renders 'warn' tier and shows compact button between 70% and 90%", async () => {
    // 320 chars / 4 = 80 tokens = 80% of 100.
    useChatStore.getState().addMessage(makeMessage("m1", "a".repeat(320)));

    render(
      <UsageChip conversationId="conv-1" employeeModelRef="OpenRouter/gpt-4o-mini" />,
    );
    await flush();

    expect(screen.getByTestId("usage-chip").getAttribute("data-tier")).toBe("warn");
    expect(screen.getByTestId("usage-chip-compact")).toBeTruthy();
  });

  it("renders 'danger' tier at or above 90%", async () => {
    // 400 chars / 4 = 100 tokens = 100%.
    useChatStore.getState().addMessage(makeMessage("m1", "a".repeat(400)));

    render(
      <UsageChip conversationId="conv-1" employeeModelRef="OpenRouter/gpt-4o-mini" />,
    );
    await flush();

    expect(screen.getByTestId("usage-chip").getAttribute("data-tier")).toBe("danger");
    expect(screen.getByTestId("usage-chip-compact")).toBeTruthy();
  });

  it("compacts and replaces store messages when 整理 is clicked", async () => {
    // Push us over threshold.
    for (let i = 0; i < 5; i++) {
      useChatStore.getState().addMessage(makeMessage(`m${i}`, "a".repeat(80)));
    }

    render(
      <UsageChip conversationId="conv-1" employeeModelRef="OpenRouter/gpt-4o-mini" />,
    );
    await flush();

    const btn = screen.getByTestId("usage-chip-compact") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn);
    });
    await flush();

    const state = useChatStore.getState();
    expect(state.messages.length).toBe(1);
    const sole = state.messages[0]!;
    expect(sole.role).toBe("system");
    expect(sole.content).toContain("压缩");

    const compactCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith("/compact"),
    );
    expect(compactCall).toBeTruthy();
  });

  it("falls back to 128k when model ref can't be resolved", async () => {
    useChatStore.getState().addMessage(makeMessage("m1", "a".repeat(400)));

    render(<UsageChip conversationId="conv-1" employeeModelRef="Unknown/ghost" />);
    await flush();

    // 400/4 = 100 tokens; 128000 window → still 'ok' tier.
    const chip = screen.getByTestId("usage-chip");
    expect(chip.getAttribute("data-tier")).toBe("ok");
    expect(chip.textContent).toContain("128");
  });
});
