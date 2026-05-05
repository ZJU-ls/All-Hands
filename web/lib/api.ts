import type { RenderPayload, ToolCall } from "@/lib/protocol";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Backend process is unreachable (uvicorn down / restarting / crashed).
 *
 * Next.js dev rewrites `/api/*` → `http://localhost:8000/api/*`; when upstream
 * is offline the dev server answers `500 text/plain "Internal Server Error"`
 * instead of a JSON error from our FastAPI app. We detect that shape and raise
 * this subclass so callers can render an actionable "backend offline" state
 * with retry, rather than a raw red "500" banner. See L07 / E14.
 */
export class BackendUnreachableError extends ApiError {
  constructor(label: string, status: number) {
    super(status, `${label}: backend unreachable (status ${status})`);
    this.name = "BackendUnreachableError";
  }
}

async function checkResponse(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const ct = res.headers.get("content-type") ?? "";
  const looksLikeProxyError =
    (res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) &&
    !ct.toLowerCase().includes("application/json");
  if (looksLikeProxyError) {
    throw new BackendUnreachableError(`${label} failed`, res.status);
  }
  throw new ApiError(res.status, `${label} failed: ${res.status}`);
}

export type EmployeeStatus = "draft" | "published" | "archived";

export type EmployeeDto = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  is_lead_agent: boolean;
  tool_ids: string[];
  skill_ids: string[];
  max_iterations: number;
  model_ref: string;
  status: EmployeeStatus;
  published_at: string | null;
};

export type EmployeeCreateInput = {
  name: string;
  description?: string;
  system_prompt?: string;
  model_ref?: string;
  tool_ids?: string[];
  skill_ids?: string[];
  max_iterations?: number;
  status?: EmployeeStatus;
};

export type EmployeeUpdateInput = Partial<Omit<EmployeeCreateInput, "name" | "status">>;

export type SkillDto = {
  id: string;
  name: string;
  description: string;
  tool_ids: string[];
  /** "builtin" | "market" | "github" | "uploaded" — populated by /api/skills.
   *  Optional in the type because older callers / fixture mocks may omit it. */
  source?: string;
  version?: string;
  installed_at?: string | null;
};

export type McpServerDto = {
  id: string;
  name: string;
  transport: string;
  enabled: boolean;
  health: string;
};

export type ConversationDto = {
  id: string;
  employee_id: string;
  title: string | null;
  model_ref_override: string | null;
  // Three-stage resolved (provider/model) — what will actually run this turn.
  // Differs from `model_ref_override` when the override / employee.model_ref
  // points at a provider/model that isn't actually configured: the backend
  // falls through to the workspace default and surfaces it here so the chip
  // can show the truthful binding instead of a stale label.
  effective_model_ref: string | null;
  effective_model_source: "override" | "employee" | "global_default" | null;
  created_at: string;
  /** 2026-04-28 · run_id of an in-flight agent task for this conversation,
   * or null if no run is active. The chat page reads this on mount and
   * resubscribes via POST /runs/{id}/subscribe so a tab switch / route
   * change / refresh doesn't kill the underlying SSE stream. */
  active_run_id?: string | null;
};

export async function getConversation(id: string): Promise<ConversationDto> {
  const res = await fetch(`${BASE}/api/conversations/${id}`);
  await checkResponse(res, "getConversation");
  return res.json() as Promise<ConversationDto>;
}

/**
 * Partial metadata update. Use `clear_model_ref_override: true` to reset the
 * override to null (inherit the employee's model_ref). Omit the
 * `model_ref_override` field to leave it unchanged — Pydantic can't tell
 * "omitted" from "null" so the explicit clear flag avoids that ambiguity.
 */
export type UpdateConversationInput = {
  title?: string;
  model_ref_override?: string;
  clear_model_ref_override?: boolean;
};

export async function updateConversation(
  id: string,
  body: UpdateConversationInput,
): Promise<ConversationDto> {
  const res = await fetch(`${BASE}/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, `updateConversation failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<ConversationDto>;
}

export async function getEmployee(id: string): Promise<EmployeeDto> {
  const res = await fetch(`${BASE}/api/employees/${id}`);
  await checkResponse(res, "getEmployee");
  return res.json() as Promise<EmployeeDto>;
}

export async function listEmployees(opts: { status?: EmployeeStatus } = {}): Promise<
  EmployeeDto[]
> {
  const qs = opts.status ? `?status=${encodeURIComponent(opts.status)}` : "";
  const res = await fetch(`${BASE}/api/employees${qs}`);
  if (!res.ok) throw new Error(`listEmployees failed: ${res.status}`);
  return res.json() as Promise<EmployeeDto[]>;
}

export async function publishEmployee(id: string): Promise<EmployeeDto> {
  const res = await fetch(`${BASE}/api/employees/${id}/publish`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`publishEmployee failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<EmployeeDto>;
}

export async function listConversations(
  filter: { employeeId?: string } = {},
): Promise<ConversationDto[]> {
  const qs = filter.employeeId ? `?employee_id=${encodeURIComponent(filter.employeeId)}` : "";
  const res = await fetch(`${BASE}/api/conversations${qs}`);
  if (!res.ok) throw new Error(`listConversations failed: ${res.status}`);
  return res.json() as Promise<ConversationDto[]>;
}

export type ChatMessageDto = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  created_at: string;
  /**
   * Persisted render envelopes — empty for text-only turns. Populated when
   * the assistant invoked render tools (allhands.render.*) and must be
   * rehydrated on history reload so charts / cards / tables don't vanish.
   */
  render_payloads?: RenderPayload[];
  /**
   * Persisted tool call records — empty for turns with no tool activity.
   * Rehydrates inline system-tool chips (L14) + external tool cards after
   * the live SSE has closed.
   */
  tool_calls?: ToolCall[];
  /**
   * Reasoning / thinking transcript for assistant rows backed by a
   * thinking-capable model (Anthropic Extended Thinking, Qwen3
   * enable_thinking, DeepSeek-R1). None otherwise.
   */
  reasoning?: string | null;
  /**
   * 2026-04-25 · True when the producing turn was cut short (user 中止 ·
   * SSE drop · backend mid-stream error). Whatever streamed before the
   * cut is still on this row; the bubble renders an 「已中止」 tail to
   * tell the reader the answer is incomplete.
   */
  interrupted?: boolean;
  /**
   * 2026-04-28 · Manual /compact has folded this message into a summary.
   * UI keeps the row in the transcript but hides it behind a "N 条已压缩"
   * fold; the LLM context build path filters it out so the token budget
   * shrinks. The synthetic summary marker (role=system) keeps this false
   * so it survives the filter and reaches the model.
   */
  is_compacted?: boolean;
};

export async function listConversationMessages(
  conversationId: string,
): Promise<ChatMessageDto[]> {
  const res = await fetch(`${BASE}/api/conversations/${conversationId}/messages`);
  await checkResponse(res, "listConversationMessages");
  return res.json() as Promise<ChatMessageDto[]>;
}

export type CompactResult = {
  dropped: number;
  summary_id: string | null;
  messages: ChatMessageDto[];
};

export async function compactConversation(
  conversationId: string,
  keepLast?: number,
): Promise<CompactResult> {
  const res = await fetch(`${BASE}/api/conversations/${conversationId}/compact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(keepLast !== undefined ? { keep_last: keepLast } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, `compactConversation failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<CompactResult>;
}

export async function createConversation(employeeId: string): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employee_id: employeeId }),
  });
  if (!res.ok) throw new Error(`createConversation failed: ${res.status}`);
  return res.json() as Promise<{ id: string }>;
}

export async function resolveConfirmation(
  confirmationId: string,
  decision: "approve" | "reject",
): Promise<void> {
  const res = await fetch(`${BASE}/api/confirmations/${confirmationId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  // 204 = success; 404 = already resolved / expired / never persisted (e.g.
  // interrupt-sourced pause whose tap didn't land yet — ADR 0014 Phase 4e).
  // Either way the UI can safely forget the confirmation — treating 404 as
  // a crash dead-ended the user with no recovery, so we downgrade to a warn.
  if (res.ok || res.status === 204 || res.status === 404) {
    return;
  }
  throw new Error(`resolveConfirmation failed: ${res.status}`);
}

export async function answerUserInput(
  userInputId: string,
  answers: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${BASE}/api/user-input/${userInputId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  if (res.ok || res.status === 204 || res.status === 404) {
    return;
  }
  throw new Error(`answerUserInput failed: ${res.status}`);
}

export async function getPendingConfirmations(): Promise<unknown[]> {
  const res = await fetch(`${BASE}/api/confirmations/pending`);
  if (!res.ok) return [];
  return res.json() as Promise<unknown[]>;
}

export async function createEmployee(body: EmployeeCreateInput): Promise<EmployeeDto> {
  const res = await fetch(`${BASE}/api/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createEmployee failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<EmployeeDto>;
}

export async function updateEmployee(
  id: string,
  body: EmployeeUpdateInput,
): Promise<EmployeeDto> {
  const res = await fetch(`${BASE}/api/employees/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`updateEmployee failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<EmployeeDto>;
}

export async function deleteEmployee(
  id: string,
  opts: { hard?: boolean } = {},
): Promise<void> {
  // Default = soft delete (archive). Hard=true permanently drops the row;
  // surfaced only behind the 「永久删除」 button inside the 已离职 tab.
  const qs = opts.hard ? "?hard=true" : "";
  const res = await fetch(`${BASE}/api/employees/${id}${qs}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(`deleteEmployee failed: ${res.status}`);
  }
}

export async function restoreEmployee(id: string): Promise<EmployeeDto> {
  const res = await fetch(`${BASE}/api/employees/${id}/restore`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`restoreEmployee failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<EmployeeDto>;
}

export async function listSkills(): Promise<SkillDto[]> {
  const res = await fetch(`${BASE}/api/skills`);
  if (!res.ok) throw new Error(`listSkills failed: ${res.status}`);
  return res.json() as Promise<SkillDto[]>;
}

export async function listMcpServers(): Promise<McpServerDto[]> {
  const res = await fetch(`${BASE}/api/mcp-servers`);
  if (!res.ok) throw new Error(`listMcpServers failed: ${res.status}`);
  return res.json() as Promise<McpServerDto[]>;
}

export type ProviderDto = {
  id: string;
  name: string;
  kind: "openai" | "anthropic" | "aliyun";
  base_url: string;
  api_key_set: boolean;
  enabled: boolean;
};

export type ModelCapability = "chat" | "image_gen" | "speech" | "embedding";

export type ModelDto = {
  id: string;
  provider_id: string;
  name: string;
  display_name: string;
  context_window: number;
  // Optional advanced caps — null when "use model default" (no max_tokens
  // sent on outbound chat; chip falls back to context_window). When set,
  // max_input_tokens drives the composer's budget chip denominator and
  // max_output_tokens is forwarded as max_tokens on outbound chat requests.
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  enabled: boolean;
  // Singleton across the whole table — at most one model has is_default=true.
  is_default: boolean;
  // 2026-04-28 · multi-modal capability picker (MODEL-GATEWAY.html § 5).
  // Existing models default to ["chat"] via alembic 0037 server_default;
  // image-generation models opt in by checking [image_gen] in the dialog.
  capabilities: ModelCapability[];
  // Vision (input) — distinct from capabilities (output).
  supports_images?: boolean;
};

export async function listProviders(): Promise<ProviderDto[]> {
  const res = await fetch(`${BASE}/api/providers`);
  if (!res.ok) throw new Error(`listProviders failed: ${res.status}`);
  return res.json() as Promise<ProviderDto[]>;
}

export async function listModels(): Promise<ModelDto[]> {
  const res = await fetch(`${BASE}/api/models`);
  if (!res.ok) throw new Error(`listModels failed: ${res.status}`);
  return res.json() as Promise<ModelDto[]>;
}

export type ModelCatalogLookup = {
  matched: boolean;
  name: string;
  display_name?: string;
  capabilities?: ModelCapability[];
  context_window?: number;
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
};

/** Fetch curated metadata for a typed model name. Returns matched=false
 *  if the name isn't in the catalog — the UI then leaves user input alone. */
export async function lookupModelCatalog(
  name: string,
  providerKind?: string,
): Promise<ModelCatalogLookup> {
  const params = new URLSearchParams({ name });
  if (providerKind) params.set("provider_kind", providerKind);
  const res = await fetch(`${BASE}/api/models/catalog/lookup?${params}`);
  if (!res.ok) return { matched: false, name };
  return res.json() as Promise<ModelCatalogLookup>;
}

/**
 * Promote a (provider, model) pair to the workspace default. Atomic on the
 * backend — clears any prior default and sets this one in a single
 * transaction. Returns the freshly-promoted model + provider so the caller
 * can render "已切到 X · Y" without a re-fetch.
 */
export type SetDefaultModelResponse = {
  model: ModelDto;
  provider_id: string;
  provider_name: string;
};
export async function setDefaultModel(modelId: string): Promise<SetDefaultModelResponse> {
  const res = await fetch(`${BASE}/api/models/${modelId}/set-default`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`setDefaultModel failed: ${res.status}`);
  return res.json() as Promise<SetDefaultModelResponse>;
}

/**
 * model_ref in EmployeeDto is "provider_name/model_name" (e.g. "OpenRouter/gpt-4o-mini").
 * Returns the reference string for a model, using its provider's name as the prefix.
 */
export function buildModelRef(provider: ProviderDto, model: ModelDto): string {
  return `${provider.name}/${model.name}`;
}

/**
 * Workspace-default model ref: pick the model marked is_default=true and
 * stitch its provider's name + own name into the canonical "{provider}/{model}"
 * form. Returns null if nothing is configured — caller should leave the field
 * blank so the backend can apply its own first-enabled fallback.
 */
export function defaultModelRef(
  providers: ProviderDto[],
  models: ModelDto[],
): string | null {
  const dm = models.find((m) => m.is_default && m.enabled);
  if (!dm) return null;
  const provider = providers.find((p) => p.id === dm.provider_id && p.enabled);
  if (!provider) return null;
  return `${provider.name}/${dm.name}`;
}

export type EmployeePreset = "execute" | "plan" | "plan_with_subagent";

export type EmployeePreviewResult = {
  tool_ids: string[];
  skill_ids: string[];
  max_iterations: number;
};

export async function previewEmployeeComposition(body: {
  preset: EmployeePreset;
  custom_tool_ids?: string[];
  custom_skill_ids?: string[];
  custom_max_iterations?: number;
}): Promise<EmployeePreviewResult> {
  const res = await fetch(`${BASE}/api/employees/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`preview failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<EmployeePreviewResult>;
}

// ADR 0019 C1 · ProgressPanel data source ----------------------------

export type PlanStepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export type PlanStepDto = {
  index: number;
  title: string;
  status: PlanStepStatus;
  note: string | null;
};

export type PlanLatestDto = {
  plan_id: string;
  title: string;
  owner_employee_id: string;
  created_at: string;
  updated_at: string;
  steps: PlanStepDto[];
};

/** Fetch the latest plan for the conversation. ``null`` (200 status, null
 * body) when the agent hasn't called plan_create yet — caller should hide
 * the plan section in that case. */
export async function getLatestPlan(
  conversationId: string,
): Promise<PlanLatestDto | null> {
  const res = await fetch(
    `${BASE}/api/conversations/${conversationId}/plans/latest`,
  );
  if (!res.ok) {
    // Network / 5xx errors fall through as null so the panel stays
    // empty rather than blocking chat with an error toast.
    return null;
  }
  const body = (await res.json()) as PlanLatestDto | null;
  return body;
}
