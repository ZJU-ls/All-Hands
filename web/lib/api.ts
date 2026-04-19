const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type EmployeeDto = {
  id: string;
  name: string;
  description: string;
  is_lead_agent: boolean;
  tool_ids: string[];
  skill_ids: string[];
  max_iterations: number;
  model_ref: string;
};

export type ConversationDto = {
  id: string;
  employee_id: string;
  title: string | null;
  created_at: string;
};

export async function getConversation(id: string): Promise<ConversationDto> {
  const res = await fetch(`${BASE}/api/conversations/${id}`);
  if (!res.ok) throw new Error(`getConversation failed: ${res.status}`);
  return res.json() as Promise<ConversationDto>;
}

export async function getEmployee(id: string): Promise<EmployeeDto> {
  const res = await fetch(`${BASE}/api/employees/${id}`);
  if (!res.ok) throw new Error(`getEmployee failed: ${res.status}`);
  return res.json() as Promise<EmployeeDto>;
}

export async function listEmployees(): Promise<EmployeeDto[]> {
  const res = await fetch(`${BASE}/api/employees`);
  if (!res.ok) throw new Error(`listEmployees failed: ${res.status}`);
  return res.json() as Promise<EmployeeDto[]>;
}

export async function listConversations(
  filter: { employeeId?: string } = {},
): Promise<ConversationDto[]> {
  const qs = filter.employeeId ? `?employee_id=${encodeURIComponent(filter.employeeId)}` : "";
  const res = await fetch(`${BASE}/api/conversations${qs}`);
  if (!res.ok) throw new Error(`listConversations failed: ${res.status}`);
  return res.json() as Promise<ConversationDto[]>;
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
  if (!res.ok && res.status !== 204) {
    throw new Error(`resolveConfirmation failed: ${res.status}`);
  }
}

export async function getPendingConfirmations(): Promise<unknown[]> {
  const res = await fetch(`${BASE}/api/confirmations/pending`);
  if (!res.ok) return [];
  return res.json() as Promise<unknown[]>;
}
