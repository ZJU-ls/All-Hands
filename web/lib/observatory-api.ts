const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type BootstrapStatus = "pending" | "ok" | "failed" | "external";

export type ObservatoryEmployeeBreakdownDto = {
  employee_id: string;
  employee_name: string;
  runs_count: number;
};

export type ObservatorySummaryDto = {
  traces_total: number;
  failure_rate_24h: number;
  latency_p50_s: number;
  avg_tokens_per_run: number;
  by_employee: ObservatoryEmployeeBreakdownDto[];
  observability_enabled: boolean;
  bootstrap_status: BootstrapStatus;
  bootstrap_error: string | null;
  host: string | null;
};

export type TraceSummaryDto = {
  trace_id: string;
  employee_id: string | null;
  employee_name: string | null;
  status: "ok" | "failed";
  duration_s: number | null;
  tokens: number;
  started_at: string;
};

export async function fetchObservatorySummary(): Promise<ObservatorySummaryDto> {
  const res = await fetch(`${BASE}/api/observatory/summary`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`observatory summary failed: ${res.status}`);
  }
  return res.json() as Promise<ObservatorySummaryDto>;
}

export type SystemFlagsDto = {
  bootstrap_status: BootstrapStatus;
  bootstrap_error: string | null;
  host: string | null;
  observability_enabled: boolean;
  auto_title_enabled: boolean;
  bootstrapped_at: string | null;
};

export async function fetchSystemFlags(): Promise<SystemFlagsDto> {
  const res = await fetch(`${BASE}/api/observatory/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`observatory status failed: ${res.status}`);
  return res.json() as Promise<SystemFlagsDto>;
}

export async function patchSystemFlags(
  body: { auto_title_enabled?: boolean },
): Promise<{ auto_title_enabled: boolean; bootstrap_status: BootstrapStatus; observability_enabled: boolean }> {
  const res = await fetch(`${BASE}/api/observatory/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`observatory patch failed: ${res.status}`);
  return res.json();
}

export async function retryBootstrap(): Promise<{
  bootstrap_status: BootstrapStatus;
  bootstrap_error: string | null;
  observability_enabled: boolean;
}> {
  const res = await fetch(`${BASE}/api/observatory/bootstrap`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`bootstrap retry failed: ${res.status}`);
  }
  return res.json();
}

export type TurnUserInputDto = {
  kind: "user_input";
  content: string;
  ts: string;
};

export type TurnThinkingDto = {
  kind: "thinking";
  content: string;
  ts: string;
};

export type TurnToolCallDto = {
  kind: "tool_call";
  tool_call_id: string;
  name: string;
  args: unknown;
  result: unknown | null;
  error: string | null;
  ts_called: string;
  ts_returned: string | null;
};

export type TurnMessageDto = {
  kind: "message";
  content: string;
  ts: string;
};

export type TurnDto =
  | TurnUserInputDto
  | TurnThinkingDto
  | TurnToolCallDto
  | TurnMessageDto;

export type RunStatusDto = "running" | "succeeded" | "failed" | "cancelled";

export type RunTokenUsageDto = {
  prompt: number;
  completion: number;
  total: number;
};

export type RunErrorDto = {
  message: string;
  kind: string;
};

export type RunDetailDto = {
  run_id: string;
  task_id: string | null;
  conversation_id: string;
  employee_id: string | null;
  employee_name: string | null;
  status: RunStatusDto;
  started_at: string;
  finished_at: string | null;
  duration_s: number | null;
  tokens: RunTokenUsageDto;
  error: RunErrorDto | null;
  turns: TurnDto[];
};

export async function fetchRunDetail(runId: string): Promise<RunDetailDto> {
  const res = await fetch(
    `${BASE}/api/observatory/runs/${encodeURIComponent(runId)}`,
    { cache: "no-store" },
  );
  if (res.status === 404) {
    throw new RunNotFoundError(runId);
  }
  if (!res.ok) {
    throw new Error(`run detail failed: ${res.status}`);
  }
  return res.json() as Promise<RunDetailDto>;
}

export class RunNotFoundError extends Error {
  constructor(public readonly runId: string) {
    super(`run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

export async function fetchTraces(params?: {
  employee_id?: string;
  status?: "ok" | "failed";
  since?: string;
  until?: string;
  limit?: number;
}): Promise<{ traces: TraceSummaryDto[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.employee_id) q.set("employee_id", params.employee_id);
  if (params?.status) q.set("status", params.status);
  if (params?.since) q.set("since", params.since);
  if (params?.until) q.set("until", params.until);
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  const res = await fetch(
    `${BASE}/api/observatory/traces${qs ? `?${qs}` : ""}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`observatory traces failed: ${res.status}`);
  }
  return res.json();
}
