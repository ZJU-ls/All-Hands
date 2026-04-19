const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type TaskStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "needs_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskSource = "user" | "lead" | "trigger" | "employee";

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export const PENDING_USER_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "needs_input",
  "needs_approval",
]);

export type TaskDto = {
  id: string;
  workspace_id: string;
  title: string;
  goal: string;
  dod: string;
  assignee_id: string;
  status: TaskStatus;
  source: TaskSource;
  created_by: string;
  parent_task_id: string | null;
  run_ids: string[];
  artifact_ids: string[];
  conversation_id: string | null;
  result_summary: string | null;
  error_summary: string | null;
  pending_input_question: string | null;
  pending_approval_payload: Record<string, unknown> | null;
  token_budget: number | null;
  tokens_used: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type CreateTaskBody = {
  title: string;
  goal: string;
  dod: string;
  assignee_id: string;
  token_budget?: number | null;
};

function toUrl(path: string, params?: Record<string, string | string[] | undefined>): string {
  const url = new URL(`${BASE}${path}`, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, item);
      } else {
        url.searchParams.set(k, v);
      }
    }
  }
  // If BASE is empty, keep the path only (same-origin fetch).
  return BASE ? url.toString() : `${path}${url.search}`;
}

export async function listTasks(filter: {
  status?: TaskStatus[];
  assignee_id?: string;
  limit?: number;
} = {}): Promise<TaskDto[]> {
  const url = toUrl("/api/tasks", {
    status: filter.status,
    assignee_id: filter.assignee_id,
    limit: filter.limit ? String(filter.limit) : undefined,
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listTasks failed: ${res.status}`);
  return res.json() as Promise<TaskDto[]>;
}

export async function getTask(id: string): Promise<TaskDto> {
  const res = await fetch(`${BASE}/api/tasks/${id}`);
  if (!res.ok) throw new Error(`getTask failed: ${res.status}`);
  return res.json() as Promise<TaskDto>;
}

export async function createTask(body: CreateTaskBody): Promise<TaskDto> {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(detail.detail || `createTask failed: ${res.status}`);
  }
  return res.json() as Promise<TaskDto>;
}

export async function cancelTask(id: string, reason?: string): Promise<TaskDto> {
  const res = await fetch(`${BASE}/api/tasks/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason ?? null }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(detail.detail || `cancelTask failed: ${res.status}`);
  }
  return res.json() as Promise<TaskDto>;
}

export async function answerTask(id: string, answer: string): Promise<TaskDto> {
  const res = await fetch(`${BASE}/api/tasks/${id}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(detail.detail || `answerTask failed: ${res.status}`);
  }
  return res.json() as Promise<TaskDto>;
}

export async function approveTask(
  id: string,
  decision: "approved" | "denied",
  note?: string,
): Promise<TaskDto> {
  const res = await fetch(`${BASE}/api/tasks/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note: note ?? null }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(detail.detail || `approveTask failed: ${res.status}`);
  }
  return res.json() as Promise<TaskDto>;
}

export function statusLabel(s: TaskStatus): string {
  switch (s) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "needs_input":
      return "等你回答";
    case "needs_approval":
      return "等你审批";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

export function statusTone(s: TaskStatus): "neutral" | "info" | "warn" | "success" | "danger" {
  switch (s) {
    case "queued":
      return "neutral";
    case "running":
      return "info";
    case "needs_input":
    case "needs_approval":
      return "warn";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
      return "neutral";
  }
}

export function sourceLabel(s: TaskSource): string {
  return { user: "用户", lead: "Lead", trigger: "触发器", employee: "员工" }[s];
}
