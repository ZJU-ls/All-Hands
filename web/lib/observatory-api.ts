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

export async function fetchTraces(params?: {
  employee_id?: string;
  status?: "ok" | "failed";
  limit?: number;
}): Promise<{ traces: TraceSummaryDto[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.employee_id) q.set("employee_id", params.employee_id);
  if (params?.status) q.set("status", params.status);
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
