/**
 * History rehydrate · fold role="tool" rows into the preceding assistant's
 * matching ``tool_call``.
 *
 * The backend persists each tool result as its own ``role=tool`` Message row
 * (needed for LangChain context build · {assistant, tool_calls} → {tool,
 * tool_call_id, content}). Streaming UI never sees these rows — segments are
 * built client-side from SSE events. On reload though, GET /messages returns
 * them, and MessageBubble renders anything that isn't role=user as an agent
 * bubble · result: a single multi-step turn shows up as N segmented bubbles
 * (assistant + ToolResult + assistant + ToolResult …) with the tool_call
 * cards stuck on "running" because results never made it back into the
 * assistant's tool_calls[] at persistence time.
 *
 * Fold rule: for every tool row m, scan back to the nearest assistant row
 * that owns a tool_call with ``id === m.tool_call_id``. Promote the row's
 * content into ``tool_call.result``, mark ``status="succeeded"`` if still
 * pending. Then drop the tool row from the visible transcript.
 *
 * Failure detection: backend writes the original error text as the tool
 * row's content for failed calls (chat_service.py:1186) but doesn't tag the
 * row distinctly. We optimistically mark all folded tool_calls as
 * succeeded — the content (error text or JSON) ends up in result either
 * way, which is what the ToolCallCard shows. "Forever spinning" is the
 * worse UX; "completed with error-shaped result" is acceptable.
 */
import type { Message, ToolCall } from "./protocol";

type WireMessage = Message & { role: "user" | "assistant" | "tool" | "system" };

function tryParseJson(text: string): unknown {
  if (!text) return text;
  const trimmed = text.trim();
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return text;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export function foldToolMessages(messages: WireMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const targetCallId = m.tool_call_id;
      if (!targetCallId) {
        // Orphan tool row · no anchor to fold into. Drop it (raw JSON in a
        // bubble is never the right thing to show).
        continue;
      }
      // Search back through already-emitted rows for the assistant that
      // owns this tool_call.
      for (let i = out.length - 1; i >= 0; i--) {
        const prior = out[i];
        if (!prior || prior.role !== "assistant") continue;
        const idx = prior.tool_calls.findIndex((tc) => tc.id === targetCallId);
        if (idx < 0) continue;
        const updated: ToolCall = {
          ...prior.tool_calls[idx]!,
          result: tryParseJson(m.content),
          status:
            prior.tool_calls[idx]!.status === "running" ||
            prior.tool_calls[idx]!.status === "pending" ||
            prior.tool_calls[idx]!.status === "awaiting_confirmation"
              ? "succeeded"
              : prior.tool_calls[idx]!.status,
        };
        const nextCalls = [...prior.tool_calls];
        nextCalls[idx] = updated;
        out[i] = { ...prior, tool_calls: nextCalls };
        break;
      }
      // Either folded or orphan — never emit the tool row as its own bubble.
      continue;
    }
    out.push(m);
  }
  return out;
}
