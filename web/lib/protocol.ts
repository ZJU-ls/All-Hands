/**
 * Transport protocol — mirrors backend allhands/api/protocol.py.
 *
 * Any schema change here MUST be matched on the backend (and vice versa).
 * tests/integration/test_render_protocol.py checks schema parity end-to-end.
 */

export type MessageRole = "user" | "assistant" | "tool" | "system";

export type ToolCallStatus =
  | "pending"
  | "awaiting_confirmation"
  | "running"
  | "succeeded"
  | "failed"
  | "rejected";

export type ToolCall = {
  id: string;
  tool_id: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  error?: string | null;
};

export type RenderPayload = {
  component: string;
  props: Record<string, unknown>;
  interactions: Array<{
    kind: "button" | "form_submit" | "link";
    label: string;
    action: string;
    payload?: Record<string, unknown>;
  }>;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_calls: ToolCall[];
  render_payloads: RenderPayload[];
  created_at: string;
};

/** SSE event envelope — narrow union per backend allhands/api/protocol.py. */
export type SSEEvent =
  | { type: "message.delta"; message_id: string; delta: string }
  | { type: "message.final"; message: Message }
  | { type: "tool_call.update"; tool_call: ToolCall }
  | { type: "confirmation.requested"; confirmation_id: string; tool_call_id: string }
  | { type: "render"; message_id: string; payload: RenderPayload }
  | { type: "run.end"; reason: "done" | "max_iterations" | "error"; error?: string };
