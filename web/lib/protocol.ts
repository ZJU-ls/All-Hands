/**
 * Transport protocol — mirrors backend allhands/api/protocol.py and
 * allhands/execution/events.py.
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

export type RenderInteraction = {
  kind: "button" | "form_submit" | "link";
  label: string;
  action: string;
  payload?: Record<string, unknown>;
};

export type RenderPayload = {
  component: string;
  props: Record<string, unknown>;
  interactions: RenderInteraction[];
};

/**
 * ADR 0019 C3 · clarification request from ``ask_user_question``.
 * Mirrors the backend ``UserInputRequiredEvent`` payload shape.
 */
export type PendingUserInputQuestion = {
  label: string;
  description: string;
  preview?: string | null;
};

export type PendingUserInput = {
  userInputId: string;
  toolCallId: string;
  questions: PendingUserInputQuestion[];
};

/**
 * EmployeeCardProps — mirrors backend EmployeeCardProps in protocol.py.
 * Target component is `EmployeeCard` (registered in component-registry).
 */
export type EmployeeCardStatus = "draft" | "active" | "paused";

export type EmployeeCardModelRef = {
  provider: string;
  name: string;
};

export type EmployeeCardProps = {
  employee_id: string;
  name: string;
  role?: string;
  avatar_initial?: string;
  system_prompt_preview?: string;
  skill_count?: number;
  tool_count?: number;
  model?: EmployeeCardModelRef;
  status?: EmployeeCardStatus;
};

/**
 * PlanCardProps — mirrors backend PlanCardProps in protocol.py.
 * Target component is `PlanCard` (spec § 6.1 · awaits human approval).
 */
export type PlanCardStepStatus = "pending" | "approved" | "rejected";

export type PlanCardStep = {
  id: string;
  title: string;
  body?: string;
  status: PlanCardStepStatus;
};

export type PlanCardProps = {
  plan_id: string;
  title: string;
  steps: PlanCardStep[];
};

/**
 * MessageSegment — ordered pointer into the parallel `tool_calls` /
 * `render_payloads` arrays of a Message, plus inline text chunks.
 *
 * The original Message model bucketed content / tool_calls / render_payloads
 * into three separate arrays rendered as three stacked blocks. That made the
 * assistant's narrative illegible for turns like "text A → render → text B
 * → render" — everything collapsed into
 * "text A + text B / tool_1 + tool_2 / render_1 + render_2".
 *
 * `segments` captures the actual temporal order so MessageBubble can render
 * the narrative as it streamed, with Viz cards inline between text chunks.
 * Optional because:
 *  - historical messages loaded from the DB don't have per-turn tool/render
 *    history persisted, so they just carry `content` and render legacy.
 *  - user messages don't produce tool calls, they have no segments.
 */
export type MessageSegment =
  | { kind: "text"; content: string }
  | { kind: "tool_call"; tool_call_id: string }
  | { kind: "render"; index: number };

export type Message = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  /**
   * Reasoning / thinking transcript. Populated from AG-UI
   * ``REASONING_MESSAGE_CHUNK`` frames for assistant messages coming from
   * thinking-capable models (Anthropic Extended Thinking, Qwen3
   * enable_thinking, DeepSeek-R1). UI-only — the server-side ``Message``
   * schema does not yet persist reasoning across reloads; we keep it on
   * the wire type here so the in-flight streaming bubble can hand its
   * reasoning to MessageBubble on finalize. Optional so legacy fixtures
   * remain valid.
   */
  reasoning?: string;
  tool_calls: ToolCall[];
  render_payloads: RenderPayload[];
  /** Ordered narrative of the assistant turn. See MessageSegment. */
  segments?: MessageSegment[];
  tool_call_id?: string | null;
  trace_ref?: string | null;
  parent_run_id?: string | null;
  created_at: string;
};

/** SSE event envelope — mirrors backend allhands/execution/events.py AgentEvent union. */
export type SSEEvent =
  | { kind: "token"; message_id: string; delta: string }
  | { kind: "tool_call_start"; tool_call: ToolCall }
  | { kind: "tool_call_end"; tool_call: ToolCall }
  | {
      kind: "confirm_required";
      confirmation_id: string;
      tool_call_id: string;
      summary: string;
      rationale: string;
      diff?: Record<string, unknown> | null;
    }
  | { kind: "confirm_resolved"; confirmation_id: string; status: string }
  | { kind: "render"; message_id: string; payload: RenderPayload }
  | {
      kind: "nested_run_start";
      run_id: string;
      parent_run_id: string | null;
      employee_name: string;
    }
  | { kind: "nested_run_end"; run_id: string; status: string }
  | { kind: "trace"; trace_id: string; url?: string | null }
  | { kind: "error"; code: string; message: string }
  | { kind: "done"; message_id: string; reason: "done" | "max_iterations" | "error" }
  | { kind: string; [key: string]: unknown };
