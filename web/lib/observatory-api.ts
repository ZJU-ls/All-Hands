const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type ObservatoryEmployeeBreakdownDto = {
  employee_id: string;
  employee_name: string;
  runs_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
};

export type ObservatoryModelBreakdownDto = {
  model_ref: string;
  runs_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
};

export type ObservatoryToolBreakdownDto = {
  tool_id: string;
  invocations: number;
  failures: number;
  failure_rate: number;
  avg_duration_s: number;
};

export type ObservatoryErrorBreakdownDto = {
  error_kind: string;
  count: number;
  last_message: string;
  last_seen_at: string | null;
};

export type ObservatorySummaryDto = {
  traces_total: number;
  failure_rate_24h: number;
  latency_p50_s: number;
  latency_p95_s: number;
  latency_p99_s: number;
  avg_tokens_per_run: number;
  input_tokens_total: number;
  output_tokens_total: number;
  total_tokens_total: number;
  llm_calls_total: number;
  estimated_cost_usd: number;
  runs_delta_pct: number | null;
  failure_rate_delta_pct: number | null;
  latency_p50_delta_pct: number | null;
  cost_delta_pct: number | null;
  by_employee: ObservatoryEmployeeBreakdownDto[];
  by_model: ObservatoryModelBreakdownDto[];
  by_tool: ObservatoryToolBreakdownDto[];
  top_errors: ObservatoryErrorBreakdownDto[];
  latency_heatmap: number[][];
  latency_heatmap_buckets_s: number[];
  anomalies: string[];
};

export type RunTokenUsageDto = {
  prompt: number;
  completion: number;
  total: number;
};

export type TraceSummaryDto = {
  trace_id: string;
  employee_id: string | null;
  employee_name: string | null;
  model_ref: string | null;
  status: "ok" | "failed" | "running";
  duration_s: number | null;
  tokens: RunTokenUsageDto;
  llm_calls: number;
  started_at: string;
};

export async function fetchObservatorySummary(
  params: { hours?: number; employee_id?: string; model_ref?: string } = {},
): Promise<ObservatorySummaryDto> {
  const q = new URLSearchParams();
  q.set("hours", String(params.hours ?? 24));
  if (params.employee_id) q.set("employee_id", params.employee_id);
  if (params.model_ref) q.set("model_ref", params.model_ref);
  const res = await fetch(
    `${BASE}/api/observatory/summary?${q.toString()}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`observatory summary failed: ${res.status}`);
  }
  return res.json() as Promise<ObservatorySummaryDto>;
}

export type ObservatoryMetric =
  | "runs"
  | "failure_rate"
  | "latency_p50"
  | "latency_p95"
  | "latency_p99"
  | "tokens_total"
  | "tokens_input"
  | "tokens_output"
  | "llm_calls"
  | "cost";

export type TimeSeriesPointDto = {
  ts: string;
  value: number;
  count: number;
};

export type TimeSeriesDto = {
  metric: ObservatoryMetric;
  bucket: "5m" | "1h";
  since: string;
  until: string;
  points: TimeSeriesPointDto[];
  unit: string;
};

export async function fetchMetricSeries(params: {
  metric: ObservatoryMetric;
  since?: string;
  until?: string;
  bucket?: "5m" | "1h";
  employee_id?: string;
  model_ref?: string;
}): Promise<TimeSeriesDto> {
  const q = new URLSearchParams();
  q.set("metric", params.metric);
  if (params.since) q.set("since", params.since);
  if (params.until) q.set("until", params.until);
  if (params.bucket) q.set("bucket", params.bucket);
  if (params.employee_id) q.set("employee_id", params.employee_id);
  if (params.model_ref) q.set("model_ref", params.model_ref);
  const res = await fetch(`${BASE}/api/observatory/series?${q.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`series failed: ${res.status}`);
  return res.json() as Promise<TimeSeriesDto>;
}

export type SystemFlagsDto = {
  observability_enabled: boolean;
  auto_title_enabled: boolean;
};

export async function fetchSystemFlags(): Promise<SystemFlagsDto> {
  const res = await fetch(`${BASE}/api/observatory/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`observatory status failed: ${res.status}`);
  return res.json() as Promise<SystemFlagsDto>;
}

export async function patchSystemFlags(
  body: { auto_title_enabled?: boolean },
): Promise<{ auto_title_enabled: boolean; observability_enabled: boolean }> {
  const res = await fetch(`${BASE}/api/observatory/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`observatory patch failed: ${res.status}`);
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

export type TurnLLMCallDto = {
  kind: "llm_call";
  call_index: number;
  model_ref: string | null;
  duration_s: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  ts: string;
};

export type TurnDto =
  | TurnUserInputDto
  | TurnThinkingDto
  | TurnToolCallDto
  | TurnMessageDto
  | TurnLLMCallDto;

export type RunStatusDto = "running" | "succeeded" | "failed" | "cancelled";

export type RunErrorDto = {
  message: string;
  kind: string;
};

export type ArtifactSummaryDto = {
  id: string;
  name: string;
  kind: string;
  mime_type: string;
  version: number;
  size_bytes: number;
  pinned: boolean;
  created_at: string;
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
  llm_calls: number;
  model_ref: string | null;
  estimated_cost_usd: number;
  error: RunErrorDto | null;
  turns: TurnDto[];
  artifacts: ArtifactSummaryDto[];
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
  model_ref?: string;
  status?: "ok" | "failed" | "running";
  since?: string;
  until?: string;
  q?: string;
  limit?: number;
}): Promise<{ traces: TraceSummaryDto[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.employee_id) q.set("employee_id", params.employee_id);
  if (params?.model_ref) q.set("model_ref", params.model_ref);
  if (params?.status) q.set("status", params.status);
  if (params?.since) q.set("since", params.since);
  if (params?.until) q.set("until", params.until);
  if (params?.q) q.set("q", params.q);
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
