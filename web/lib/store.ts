import { create } from "zustand";
import type {
  Message,
  MessageSegment,
  PendingUserInput,
  RenderPayload,
  ToolCall,
} from "./protocol";

export type PendingConfirmation = {
  confirmationId: string;
  toolCallId: string;
  summary: string;
  rationale: string;
  diff?: Record<string, unknown> | null;
  /**
   * Conversation the interrupt originated from (ADR 0014 Phase 4e). The
   * ConfirmationDialog uses this to POST /conversations/{id}/resume after
   * calling /resolve so the paused graph continues. Optional because the
   * legacy ``allhands.confirm_required`` path (polling gate) doesn't set it;
   * the dialog falls back to resolve-only in that case.
   */
  conversationId?: string;
  /**
   * Source of the pause (ADR 0014 Phase 4e). ``"interrupt"`` = LangGraph
   * interrupt(), needs a /resume call after /resolve. ``"polling"`` = the
   * legacy gate waits on DB, no resume call needed. Kept as a string
   * rather than boolean so future sources (e.g. plan-card) can be added
   * without changing the shape.
   */
  source?: "interrupt" | "polling";
};

type StreamingMessage = {
  id: string;
  role: "assistant";
  content: string;
  /**
   * Reasoning / thinking channel accumulated from AG-UI
   * ``REASONING_MESSAGE_CHUNK`` frames. Kept alongside ``content`` so the
   * bubble can render the two distinctly — thinking lives in a collapsible
   * block above the answer, visible content is the final markdown. Before
   * this field the runner was stringifying Python reasoning blocks straight
   * into ``content`` and leaking ``[{'thinking': ..., 'type': 'thinking'}]``
   * repr into the chat.
   */
  reasoning: string;
  tool_calls: ToolCall[];
  render_payloads: RenderPayload[];
  /**
   * Temporal order of text / tool_call / render events as they streamed
   * in. MessageBubble walks this to render the assistant's narrative
   * interleaved (text A → render → text B → render) instead of three
   * bucketed blocks. Maintained by appendToken / updateToolCall /
   * addRenderPayload so the render order matches stream order.
   */
  segments: MessageSegment[];
  created_at: string;
};

function makeEmptyStreaming(messageId: string): StreamingMessage {
  return {
    id: messageId,
    role: "assistant",
    content: "",
    reasoning: "",
    tool_calls: [],
    render_payloads: [],
    segments: [],
    created_at: new Date().toISOString(),
  };
}

/**
 * A failed agent turn the UI needs to surface. Set by InputBar on
 * `RUN_ERROR` / transport errors so the chat doesn't swallow the failure
 * silently (the "试用 没有任何反应" bug — seed providers ship without api
 * keys, the upstream 401s, the backend emits `RUN_ERROR`, and before this
 * field the UI just `console.error`d it). MessageList renders the banner
 * inline so the user sees the failure exactly where the assistant reply
 * would have landed.
 */
export type StreamError = {
  message: string;
  code?: string;
};

type ChatState = {
  conversationId: string | null;
  messages: Message[];
  streamingMessage: StreamingMessage | null;
  pendingConfirmations: PendingConfirmation[];
  pendingUserInputs: PendingUserInput[];
  isStreaming: boolean;
  streamError: StreamError | null;

  setConversationId: (id: string) => void;
  addMessage: (msg: Message) => void;
  replaceMessages: (msgs: Message[]) => void;
  /** Flip `isStreaming` on the instant the user hits send, before the POST
   * even returns. Without this, `isStreaming` stays false until the first
   * TEXT_MESSAGE_START / REASONING_MESSAGE_START frame arrives — seconds of
   * wire latency during which the UI looked dead ("像是没连接上"). Also
   * clears any stale `streamError` from the previous turn so the banner
   * doesn't linger under the new in-flight bubble. */
  beginTurn: () => void;
  startStreaming: (messageId: string) => void;
  appendToken: (messageId: string, delta: string) => void;
  appendReasoning: (messageId: string, delta: string) => void;
  /** Persist the in-flight streaming message into `messages[]` and clear
   * streaming state. Idempotent — safe to call from both TEXT_MESSAGE_END
   * and RUN_FINISHED / transport onDone. If `streamingMessage` is null
   * (already finalized / nothing streamed), this just clears `isStreaming`. */
  finalizeStreaming: (conversationId: string) => void;
  /** Discard the in-flight streaming message (abort / fatal error). The
   * user's own message in `messages[]` stays. Pair with setStreamError to
   * keep the failure visible. */
  cancelStreaming: () => void;
  updateToolCall: (toolCall: ToolCall) => void;
  addRenderPayload: (messageId: string, payload: RenderPayload) => void;
  addConfirmation: (conf: PendingConfirmation) => void;
  removeConfirmation: (confirmationId: string) => void;
  addUserInput: (ui: PendingUserInput) => void;
  removeUserInput: (userInputId: string) => void;
  setStreamError: (err: StreamError | null) => void;
  reset: () => void;
};

export const useChatStore = create<ChatState>((set) => ({
  conversationId: null,
  messages: [],
  streamingMessage: null,
  pendingConfirmations: [],
  pendingUserInputs: [],
  isStreaming: false,
  streamError: null,

  setConversationId: (id) => set({ conversationId: id }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  replaceMessages: (msgs) => set({ messages: msgs }),

  beginTurn: () => set({ isStreaming: true, streamError: null }),

  startStreaming: (messageId) =>
    set((state) => {
      // If REASONING_MESSAGE_CHUNK already seeded the streaming message
      // (thinking frames often precede the first text token), preserve the
      // accumulated reasoning + any tool calls. Previously we unconditionally
      // reset here, which wiped the thinking buffer the moment TEXT_MESSAGE_START
      // fired — the "思考过程展示完之后会隐藏" regression: the panel rendered
      // mid-stream, dropped to zero length on TEXT_MESSAGE_START, then
      // disappeared for the rest of the turn because `hasReasoning` went false.
      if (state.streamingMessage) {
        return {
          isStreaming: true,
          streamError: null,
          streamingMessage: { ...state.streamingMessage, id: messageId },
        };
      }
      return {
        isStreaming: true,
        streamError: null,
        streamingMessage: makeEmptyStreaming(messageId),
      };
    }),

  appendToken: (_messageId, delta) =>
    set((state) => {
      if (!state.streamingMessage) return state;
      const segs = state.streamingMessage.segments;
      const last = segs[segs.length - 1];
      // Coalesce consecutive text deltas into the same text segment so the
      // narrative renders as one markdown block between tool/render events
      // instead of hundreds of one-token islands.
      const nextSegs: MessageSegment[] =
        last && last.kind === "text"
          ? [
              ...segs.slice(0, -1),
              { kind: "text", content: last.content + delta },
            ]
          : [...segs, { kind: "text", content: delta }];
      return {
        streamingMessage: {
          ...state.streamingMessage,
          content: state.streamingMessage.content + delta,
          segments: nextSegs,
        },
      };
    }),

  appendReasoning: (messageId, delta) =>
    set((state) => {
      // Reasoning may start before the first text token, so we may need to
      // seed the streaming message ourselves. Once it exists, we accumulate.
      if (!state.streamingMessage) {
        const seeded = makeEmptyStreaming(messageId);
        seeded.reasoning = delta;
        return {
          isStreaming: true,
          streamError: null,
          streamingMessage: seeded,
        };
      }
      return {
        streamingMessage: {
          ...state.streamingMessage,
          reasoning: state.streamingMessage.reasoning + delta,
        },
      };
    }),

  finalizeStreaming: (conversationId) =>
    set((state) => {
      if (!state.streamingMessage) {
        return { isStreaming: false };
      }
      // Backend should close every started tool_call with TOOL_CALL_END, but
      // a dropped SSE / provider quirk can leave a tool_call stuck on
      // "pending" / "running". Stamp those as failed at finalize so the
      // ToolCallCard renders a terminal state instead of spinning forever.
      const sealedToolCalls = state.streamingMessage.tool_calls.map((tc) =>
        tc.status === "pending" || tc.status === "running"
          ? {
              ...tc,
              status: "failed" as const,
              error: tc.error ?? "tool_call_dropped",
            }
          : tc,
      );
      const finalized: Message = {
        id: state.streamingMessage.id,
        conversation_id: conversationId,
        role: "assistant",
        content: state.streamingMessage.content,
        reasoning: state.streamingMessage.reasoning || undefined,
        tool_calls: sealedToolCalls,
        render_payloads: state.streamingMessage.render_payloads,
        segments:
          state.streamingMessage.segments.length > 0
            ? state.streamingMessage.segments
            : undefined,
        created_at: state.streamingMessage.created_at,
        tool_call_id: null,
        trace_ref: null,
        parent_run_id: null,
      };
      return {
        messages: [...state.messages, finalized],
        streamingMessage: null,
        isStreaming: false,
      };
    }),

  cancelStreaming: () =>
    set({ isStreaming: false, streamingMessage: null }),

  updateToolCall: (toolCall) =>
    set((state) => {
      if (!state.streamingMessage) return state;
      const existing = state.streamingMessage.tool_calls.find(
        (tc) => tc.id === toolCall.id,
      );
      const newCalls = existing
        ? state.streamingMessage.tool_calls.map((tc) =>
            tc.id === toolCall.id ? toolCall : tc,
          )
        : [...state.streamingMessage.tool_calls, toolCall];
      // Append a segment the first time we see this tool_call id; subsequent
      // updates (pending → running → succeeded) just mutate the tool_call
      // entry in place so the segment order stays anchored at the moment
      // the call first appeared in the stream.
      const segs = state.streamingMessage.segments;
      const nextSegs: MessageSegment[] = existing
        ? segs
        : [...segs, { kind: "tool_call", tool_call_id: toolCall.id }];
      return {
        streamingMessage: {
          ...state.streamingMessage,
          tool_calls: newCalls,
          segments: nextSegs,
        },
      };
    }),

  addRenderPayload: (_messageId, payload) =>
    set((state) => {
      if (!state.streamingMessage) return state;
      const nextIndex = state.streamingMessage.render_payloads.length;
      return {
        streamingMessage: {
          ...state.streamingMessage,
          render_payloads: [...state.streamingMessage.render_payloads, payload],
          segments: [
            ...state.streamingMessage.segments,
            { kind: "render", index: nextIndex },
          ],
        },
      };
    }),

  addConfirmation: (conf) =>
    set((state) => ({
      pendingConfirmations: [...state.pendingConfirmations, conf],
    })),

  removeConfirmation: (confirmationId) =>
    set((state) => ({
      pendingConfirmations: state.pendingConfirmations.filter(
        (c) => c.confirmationId !== confirmationId,
      ),
    })),

  addUserInput: (ui) =>
    set((state) => ({
      pendingUserInputs: [...state.pendingUserInputs, ui],
    })),

  removeUserInput: (userInputId) =>
    set((state) => ({
      pendingUserInputs: state.pendingUserInputs.filter(
        (u) => u.userInputId !== userInputId,
      ),
    })),

  setStreamError: (err) => set({ streamError: err }),

  reset: () =>
    set({
      messages: [],
      streamingMessage: null,
      pendingConfirmations: [],
      pendingUserInputs: [],
      isStreaming: false,
      streamError: null,
    }),
}));
