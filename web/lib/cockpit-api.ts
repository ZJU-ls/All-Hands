const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type ComponentStatusKind = "ok" | "degraded" | "down";
export type ActivityEventSeverity = "info" | "warn" | "error";
export type ActiveRunStatus =
  | "thinking"
  | "calling_tool"
  | "waiting_confirmation"
  | "writing";

export type ComponentStatusDto = {
  name: string;
  status: ComponentStatusKind;
  detail: string | null;
};

export type HealthSnapshotDto = {
  gateway: ComponentStatusDto;
  mcp_servers: ComponentStatusDto;
  langfuse: ComponentStatusDto;
  db: ComponentStatusDto;
  triggers: ComponentStatusDto;
};

export type ActivityEventDto = {
  id: string;
  ts: string;
  kind: string;
  actor: string | null;
  subject: string | null;
  summary: string;
  severity: ActivityEventSeverity;
  link: string | null;
};

export type ActiveRunCardDto = {
  run_id: string;
  employee_id: string;
  employee_name: string;
  status: ActiveRunStatus;
  current_action_summary: string;
  iteration: number;
  max_iterations: number;
  parent_run_id: string | null;
  depth: number;
  started_at: string;
  trigger_id: string | null;
};

export type ConvCardDto = {
  id: string;
  employee_id: string;
  employee_name: string;
  title: string;
  updated_at: string;
  message_count: number;
};

export type WorkspaceSummaryDto = {
  employees_total: number;
  runs_active: number;
  conversations_today: number;
  artifacts_total: number;
  artifacts_this_week_delta: number;
  triggers_active: number;
  tokens_today_total: number;
  tokens_today_prompt: number;
  tokens_today_completion: number;
  estimated_cost_today_usd: number;
  health: HealthSnapshotDto;
  confirmations_pending: number;
  runs_failing_recently: number;
  recent_events: ActivityEventDto[];
  active_runs: ActiveRunCardDto[];
  recent_conversations: ConvCardDto[];
  paused: boolean;
  paused_reason: string | null;
  paused_at: string | null;
};

export type PauseResponseDto = {
  paused: boolean;
  reason: string | null;
  paused_at: string | null;
  already_paused?: boolean;
};

export async function getCockpitSummary(): Promise<WorkspaceSummaryDto> {
  const res = await fetch(`${BASE}/api/cockpit/summary`);
  if (!res.ok) throw new Error(`getCockpitSummary failed: ${res.status}`);
  return res.json() as Promise<WorkspaceSummaryDto>;
}

export async function pauseAllRuns(
  reason: string,
  confirmationToken: string,
): Promise<PauseResponseDto> {
  const res = await fetch(`${BASE}/api/cockpit/pause-all`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Confirmation-Token": confirmationToken,
    },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(`pauseAllRuns failed: ${res.status}`);
  return res.json() as Promise<PauseResponseDto>;
}

export async function resumeAllRuns(): Promise<PauseResponseDto> {
  const res = await fetch(`${BASE}/api/cockpit/resume-all`, { method: "POST" });
  if (!res.ok) throw new Error(`resumeAllRuns failed: ${res.status}`);
  return res.json() as Promise<PauseResponseDto>;
}
