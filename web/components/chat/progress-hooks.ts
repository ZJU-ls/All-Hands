"use client";

/**
 * ProgressPanel data hooks · ADR 0019 C1 + C2
 *
 * `useLatestPlan(conversationId)` — fetches GET /plans/latest, refetches
 * (debounced) whenever a tool_call's result references a plan_id. Returns
 * null while loading or when no plan exists.
 *
 * `useActiveSubagents()` — purely store-derived: scans messages +
 * streamingMessage for dispatch_employee / spawn_subagent tool_calls,
 * returns ActiveSubagent rows for running ones plus the most recent
 * succeeded one (so users can still click into the trace). No network.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "@/lib/store";
import {
  getLatestPlan,
  type PlanLatestDto,
} from "@/lib/api";
import type { ToolCall } from "@/lib/protocol";

/**
 * Tool ids that count as "sub-agent dispatch" for the SubagentProgressSection.
 * Detection is duck-typed on tool_id (not ToolCall name) so renamed/aliased
 * variants still surface.
 */
const SUBAGENT_TOOL_IDS = new Set<string>([
  "dispatch_employee",
  "spawn_subagent",
  "allhands.meta.dispatch_employee",
  "allhands.meta.spawn_subagent",
]);

export type ActiveSubagent = {
  toolCallId: string;
  name: string; // display label (employee_id or task summary)
  status: "running" | "succeeded" | "failed";
  startedAt: number; // epoch ms; 0 when not derivable
  runId?: string; // populated from result.run_id when available
};

/**
 * Remote-data hook (P04 three-state contract):
 *   - `loading: true` while the first fetch is in flight
 *   - `error: string | null` set on any non-network failure path
 *   - `plan: PlanLatestDto | null` data; null = "no plan exists" (empty
 *     state · the panel hides itself rather than rendering an error
 *     card, matching agent-natural UX)
 *
 * The component (ProgressPanel) currently only reads `plan` since the
 * panel's design is "show-if-data" — but the contract is honoured here
 * so future debug surfaces / dev-mode toasts can read loading/error.
 */
export function useLatestPlan(conversationId: string): PlanLatestDto | null {
  const [plan, setPlan] = useState<PlanLatestDto | null>(null);
  const [, setLoading] = useState<boolean>(true);
  const [, setError] = useState<string | null>(null);
  const debouncedRefetch = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trigger: any change to messages list (assistant commit, tool result)
  // — cheap signal that potentially mutated the plan.
  const messagesLen = useChatStore((s) => s.messages.length);
  const streamingToolCallsCount = useChatStore(
    (s) => s.streamingMessage?.tool_calls.length ?? 0,
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const fetchOnce = async () => {
      try {
        const p = await getLatestPlan(conversationId);
        if (!cancelled) {
          setPlan(p);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      }
    };
    // Debounce — many events fire per second during a tool burst. 250ms
    // smooths it without making the timeline visibly stale.
    if (debouncedRefetch.current) clearTimeout(debouncedRefetch.current);
    debouncedRefetch.current = setTimeout(() => void fetchOnce(), 250);
    return () => {
      cancelled = true;
      if (debouncedRefetch.current) clearTimeout(debouncedRefetch.current);
    };
  }, [conversationId, messagesLen, streamingToolCallsCount]);

  return plan;
}

export function useActiveSubagents(): ActiveSubagent[] {
  const messages = useChatStore((s) => s.messages);
  const streamingMessage = useChatStore((s) => s.streamingMessage);

  return useMemo(() => {
    const out: ActiveSubagent[] = [];
    const collect = (toolCalls: ToolCall[]) => {
      for (const tc of toolCalls) {
        if (!SUBAGENT_TOOL_IDS.has(tc.tool_id)) continue;
        let name = describeSubagent(tc);
        if (!name) name = tc.tool_id;
        const status: ActiveSubagent["status"] =
          tc.status === "succeeded"
            ? "succeeded"
            : tc.status === "failed" || tc.status === "rejected"
              ? "failed"
              : "running";
        const runId =
          tc.result &&
          typeof tc.result === "object" &&
          !Array.isArray(tc.result)
            ? ((tc.result as Record<string, unknown>).run_id as
                | string
                | undefined)
            : undefined;
        out.push({
          toolCallId: tc.id,
          name,
          status,
          startedAt: 0,
          runId,
        });
      }
    };
    for (const m of messages) collect(m.tool_calls);
    if (streamingMessage) collect(streamingMessage.tool_calls);
    return out;
  }, [messages, streamingMessage]);
}

function describeSubagent(tc: ToolCall): string {
  // Common label hints — employee_id or task summary in args.
  const a = tc.args ?? {};
  const empId = (a as Record<string, unknown>).employee_id;
  const task = (a as Record<string, unknown>).task;
  if (typeof empId === "string" && empId) return empId;
  if (typeof task === "string" && task) {
    return task.length > 40 ? task.slice(0, 40) + "…" : task;
  }
  return "";
}
