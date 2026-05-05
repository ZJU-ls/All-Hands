/**
 * history-fold · role=tool rows must be folded into the preceding
 * assistant's matching tool_call (result + status), not rendered as
 * standalone bubbles.
 *
 * Bug 现场:多步 turn 重载后变成一连串气泡 ——
 *   ① assistant: 「我来注册 glm-4-plus」 + create_model[running]
 *   ② tool:     "ValueError: '[' is not a valid Capability"
 *   ③ assistant: 「让我修正参数」  + create_model[running]
 *   ④ tool:     '{"model":{"id":"...","name":"glm-4-plus",...}}'
 * Tool 行落库时不会回写到 assistant.tool_calls 的 result · 卡牌永远转圈;
 * MessageBubble 只看 isUser · 把 tool 行也当 agent 气泡画。
 *
 * 折叠后 ②/④ 应消失 · ①/③ 的 tool_call.result 拿到内容 · status=succeeded。
 */
import { describe, it, expect } from "vitest";
import { foldToolMessages } from "@/lib/history-fold";
import type { Message } from "@/lib/protocol";

type Wire = Message & { role: "user" | "assistant" | "tool" | "system" };

function asst(id: string, content: string, toolCalls: Message["tool_calls"]): Wire {
  return {
    id,
    conversation_id: "c",
    role: "assistant",
    content,
    tool_calls: toolCalls,
    render_payloads: [],
    interrupted: false,
    is_compacted: false,
    attachment_ids: [],
    tool_call_id: null,
    created_at: "2026-05-06T00:00:00Z",
  };
}

function toolRow(id: string, tcId: string, content: string): Wire {
  return {
    id,
    conversation_id: "c",
    role: "tool",
    content,
    tool_calls: [],
    render_payloads: [],
    interrupted: false,
    is_compacted: false,
    attachment_ids: [],
    tool_call_id: tcId,
    created_at: "2026-05-06T00:00:00Z",
  };
}

describe("history-fold · 多步 turn 重载折叠", () => {
  it("folds JSON tool result into the assistant's tool_call · drops the tool row", () => {
    const wire: Wire[] = [
      asst("a1", "我来注册 glm-4-plus", [
        { id: "tc1", tool_id: "create_model", args: {}, status: "running" },
      ]),
      toolRow("t1", "tc1", '{"model":{"id":"abc","name":"glm-4-plus"}}'),
    ];
    const out = foldToolMessages(wire);
    expect(out).toHaveLength(1);
    expect(out[0]!.role).toBe("assistant");
    const tc = out[0]!.tool_calls[0]!;
    expect(tc.status).toBe("succeeded");
    expect(tc.result).toEqual({ model: { id: "abc", name: "glm-4-plus" } });
  });

  it("preserves error-shaped string content as result so users see what failed", () => {
    const wire: Wire[] = [
      asst("a1", "试试", [
        { id: "tc1", tool_id: "create_model", args: {}, status: "running" },
      ]),
      toolRow("t1", "tc1", "ValueError: '[' is not a valid Capability"),
    ];
    const out = foldToolMessages(wire);
    expect(out).toHaveLength(1);
    expect(out[0]!.tool_calls[0]!.result).toBe("ValueError: '[' is not a valid Capability");
  });

  it("collapses an entire 4-bubble multi-step turn into one bubble", () => {
    const wire: Wire[] = [
      asst("a1", "step 1", [
        { id: "tc1", tool_id: "create_model", args: {}, status: "running" },
      ]),
      toolRow("t1", "tc1", "ValueError: bad arg"),
      asst("a2", "step 2 retry", [
        { id: "tc2", tool_id: "create_model", args: {}, status: "running" },
      ]),
      toolRow("t2", "tc2", '{"model":{"id":"x"}}'),
    ];
    const out = foldToolMessages(wire);
    expect(out.map((m) => m.role)).toEqual(["assistant", "assistant"]);
    expect(out[0]!.tool_calls[0]!.status).toBe("succeeded");
    expect(out[1]!.tool_calls[0]!.status).toBe("succeeded");
  });

  it("leaves already-terminal tool_calls untouched (no overwriting failed → succeeded)", () => {
    const wire: Wire[] = [
      asst("a1", "x", [
        { id: "tc1", tool_id: "t", args: {}, status: "failed", error: "boom" },
      ]),
      toolRow("t1", "tc1", "boom"),
    ];
    const out = foldToolMessages(wire);
    expect(out[0]!.tool_calls[0]!.status).toBe("failed");
  });

  it("drops orphan tool rows (no anchor) instead of rendering them as bubbles", () => {
    const wire: Wire[] = [
      asst("a1", "x", []),
      toolRow("t1", "no-such-call", "stray"),
    ];
    const out = foldToolMessages(wire);
    expect(out).toHaveLength(1);
  });

  it("user / system rows pass through untouched", () => {
    const wire: Wire[] = [
      {
        id: "u1",
        conversation_id: "c",
        role: "user",
        content: "hi",
        tool_calls: [],
        render_payloads: [],
        interrupted: false,
        is_compacted: false,
        attachment_ids: [],
        tool_call_id: null,
        created_at: "2026-05-06T00:00:00Z",
      },
    ];
    const out = foldToolMessages(wire);
    expect(out).toHaveLength(1);
    expect(out[0]!.role).toBe("user");
  });
});
