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

export type Message = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_calls: ToolCall[];
  render_payloads: RenderPayload[];
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
