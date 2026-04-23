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

  it("omits segments on finalized message when nothing streamed", () => {
    // Edge case: turn ended with zero events — the legacy layout path
    // should remain active for the rendered bubble.
    const s = useChatStore.getState();
    s.startStreaming("msg_1");
    s.finalizeStreaming("conv_1");
    const msgs = useChatStore.getState().messages;
    expect(msgs[0]!.segments).toBeUndefined();
  });
});
