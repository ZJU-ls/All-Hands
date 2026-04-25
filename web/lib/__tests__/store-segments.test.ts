/**
 * Streaming store — segment ordering contract.
 *
 * Regression guard for the "all tool cards bucketed together, then all
 * renders bucketed together, then final text" layout. The user expects the
 * assistant narrative to render in stream order (text → render → text →
 * render …). `segments` is the ordered ledger we walk to achieve that.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "../store";
import type { RenderPayload, ToolCall } from "../protocol";

function mkTool(id: string, tool_id: string): ToolCall {
  return {
    id,
    tool_id,
    args: {},
    status: "running",
  };
}

function mkRender(component: string): RenderPayload {
  return {
    component,
    props: {},
    interactions: [],
  };
}

describe("chat store · segments order", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it("coalesces consecutive token deltas into one text segment", () => {
    const s = useChatStore.getState();
    s.startStreaming("msg_1");
    s.appendToken("msg_1", "Hel");
    s.appendToken("msg_1", "lo, ");
    s.appendToken("msg_1", "world.");
    const sm = useChatStore.getState().streamingMessage;
    expect(sm).not.toBeNull();
    expect(sm!.segments.length).toBe(1);
    expect(sm!.segments[0]).toEqual({ kind: "text", content: "Hello, world." });
    expect(sm!.content).toBe("Hello, world.");
  });

  it("interleaves text / tool_call / render in stream order", () => {
    const s = useChatStore.getState();
    s.startStreaming("msg_1");
    s.appendToken("msg_1", "先展示:");
    s.updateToolCall(mkTool("c1", "allhands.render.table"));
    s.addRenderPayload("msg_1", mkRender("Viz.Table"));
    s.appendToken("msg_1", "\n再看图:");
    s.updateToolCall(mkTool("c2", "allhands.render.bar_chart"));
    s.addRenderPayload("msg_1", mkRender("Viz.BarChart"));

    const sm = useChatStore.getState().streamingMessage!;
    expect(sm.segments.map((seg) => seg.kind)).toEqual([
      "text",
      "tool_call",
      "render",
      "text",
      "tool_call",
      "render",
    ]);
    expect(sm.segments[0]).toEqual({ kind: "text", content: "先展示:" });
    expect(sm.segments[1]).toEqual({ kind: "tool_call", tool_call_id: "c1" });
    expect(sm.segments[2]).toEqual({ kind: "render", index: 0 });
    expect(sm.segments[3]).toEqual({ kind: "text", content: "\n再看图:" });
    expect(sm.segments[4]).toEqual({ kind: "tool_call", tool_call_id: "c2" });
    expect(sm.segments[5]).toEqual({ kind: "render", index: 1 });
  });

  it("does not duplicate tool_call segments on status updates", () => {
    const s = useChatStore.getState();
    s.startStreaming("msg_1");
    s.updateToolCall(mkTool("c1", "allhands.render.table"));
    // pending → running → succeeded: three updates to the same id
    s.updateToolCall({ ...mkTool("c1", "allhands.render.table"), status: "running" });
    s.updateToolCall({
      ...mkTool("c1", "allhands.render.table"),
      status: "succeeded",
      result: { component: "Viz.Table" },
    });
    const sm = useChatStore.getState().streamingMessage!;
    const toolSegs = sm.segments.filter((seg) => seg.kind === "tool_call");
    expect(toolSegs.length).toBe(1);
    expect(sm.tool_calls[0]!.status).toBe("succeeded");
  });

  it("carries segments onto the finalized Message", () => {
    const s = useChatStore.getState();
    s.startStreaming("msg_1");
    s.appendToken("msg_1", "hi");
    s.updateToolCall(mkTool("c1", "allhands.render.table"));
    s.addRenderPayload("msg_1", mkRender("Viz.Table"));
    s.finalizeStreaming("conv_1");

    const msgs = useChatStore.getState().messages;
    expect(msgs.length).toBe(1);
    const finalized = msgs[0]!;
    expect(finalized.segments).toBeDefined();
    expect(finalized.segments!.length).toBe(3);
    expect(finalized.tool_calls.length).toBe(1);
    expect(finalized.render_payloads.length).toBe(1);
  });

  it("seals dangling pending/running tool_calls as failed on finalize", () => {
    // Regression: when the SSE stream ends without a TOOL_CALL_END for a
    // started tool_call (e.g. provider drops args mid-stream), the message
    // would persist with status='pending' forever and the UI would show a
    // permanent "pending" pill. finalizeStreaming must seal them as failed.
    const s = useChatStore.getState();
    s.startStreaming("msg_1");
    s.updateToolCall({ ...mkTool("c1", "artifact_create"), status: "pending" });
    s.updateToolCall({ ...mkTool("c2", "other_tool"), status: "running" });
    s.updateToolCall({
      ...mkTool("c3", "done_tool"),
      status: "succeeded",
      result: { ok: true },
    });
    s.finalizeStreaming("conv_1");

    const finalized = useChatStore.getState().messages[0]!;
    const byId = Object.fromEntries(finalized.tool_calls.map((tc) => [tc.id, tc]));
    expect(byId.c1!.status).toBe("failed");
    expect(byId.c1!.error).toBe("tool_call_dropped");
    expect(byId.c2!.status).toBe("failed");
    expect(byId.c2!.error).toBe("tool_call_dropped");
    expect(byId.c3!.status).toBe("succeeded");
  });

  it("omits segments on finalized message when nothing streamed", () => {
    // Edge case: turn ended with zero events — the legacy layout path
    // should remain active for the rendered bubble.
    const s = useChatStore.getState();
    s.startStreaming("msg_1");
    s.finalizeStreaming("conv_1");
    const msgs = useChatStore.getState().messages;
    expect(msgs[0]!.segments).toBeUndefined();
  });

  // ---------------------------------------------------------------
  // 2026-04-25 · cancelStreaming preserves partial (Claude Code parity).
  // Original behaviour wiped streamingMessage; users lost the partial
  // bubble the moment they clicked 中止 / SSE dropped, even though the
  // backend persisted the bytes. Now finalize-with-interrupt keeps the
  // partial in messages[] with interrupted=true so MessageBubble can
  // render the 「已中止」 tail.
  describe("cancelStreaming preserves partial (interrupt parity)", () => {
    it("commits partial content with interrupted=true", () => {
      const s = useChatStore.getState();
      s.setConversationId("conv_1");
      s.beginTurn();
      s.startStreaming("msg_1");
      s.appendToken("msg_1", "Hello, I'll fetch ");
      s.appendToken("msg_1", "the weather forecast for ");
      s.cancelStreaming();

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);
      const msg = state.messages[0]!;
      expect(msg.role).toBe("assistant");
      expect(msg.content).toBe("Hello, I'll fetch the weather forecast for ");
      expect(msg.interrupted).toBe(true);
      expect(state.streamingMessage).toBeNull();
      expect(state.isStreaming).toBe(false);
    });

    it("seals pending tool_calls as failed/interrupted", () => {
      const s = useChatStore.getState();
      s.setConversationId("conv_1");
      s.beginTurn();
      s.startStreaming("msg_1");
      s.updateToolCall({
        ...mkTool("c1", "fetch_weather"),
        status: "running",
      });
      s.cancelStreaming();

      const msg = useChatStore.getState().messages[0]!;
      const tc = msg.tool_calls.find((t) => t.id === "c1")!;
      expect(tc.status).toBe("failed");
      expect(tc.error).toBe("interrupted");
      expect(msg.interrupted).toBe(true);
    });

    it("drops empty bubble (no tokens, no reasoning, no tool_calls)", () => {
      const s = useChatStore.getState();
      s.setConversationId("conv_1");
      s.beginTurn();
      s.startStreaming("msg_1");
      s.cancelStreaming();

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(0);
      expect(state.streamingMessage).toBeNull();
      expect(state.isStreaming).toBe(false);
    });

    it("keeps reasoning-only partials (thinking before any text)", () => {
      const s = useChatStore.getState();
      s.setConversationId("conv_1");
      s.beginTurn();
      s.appendReasoning("msg_1", "let me think about this…");
      s.cancelStreaming();

      const msg = useChatStore.getState().messages[0]!;
      expect(msg.content).toBe("");
      expect(msg.reasoning).toContain("let me think");
      expect(msg.interrupted).toBe(true);
    });
  });
});
