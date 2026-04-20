import { create } from "zustand";
import type { Message, RenderPayload, ToolCall } from "./protocol";

export type PendingConfirmation = {
  confirmationId: string;
  toolCallId: string;
  summary: string;
  rationale: string;
  diff?: Record<string, unknown> | null;
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
  created_at: string;
};

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
  setStreamError: (err: StreamError | null) => void;
  reset: () => void;
};

export const useChatStore = create<ChatState>((set) => ({
  conversationId: null,
  messages: [],
  streamingMessage: null,
  pendingConfirmations: [],
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
        streamingMessage: {
          id: messageId,
          role: "assistant",
          content: "",
          reasoning: "",
          tool_calls: [],
          render_payloads: [],
          created_at: new Date().toISOString(),
        },
      };
    }),

  appendToken: (_messageId, delta) =>
    set((state) => {
      if (!state.streamingMessage) return state;
      return {
        streamingMessage: {
          ...state.streamingMessage,
          content: state.streamingMessage.content + delta,
        },
      };
    }),

  appendReasoning: (messageId, delta) =>
    set((state) => {
      // Reasoning may start before the first text token, so we may need to
      // seed the streaming message ourselves. Once it exists, we accumulate.
      if (!state.streamingMessage) {
        return {
          isStreaming: true,
          streamError: null,
          streamingMessage: {
            id: messageId,
            role: "assistant",
            content: "",
            reasoning: delta,
            tool_calls: [],
            render_payloads: [],
            created_at: new Date().toISOString(),
          },
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
      const finalized: Message = {
        id: state.streamingMessage.id,
        conversation_id: conversationId,
        role: "assistant",
        content: state.streamingMessage.content,
        reasoning: state.streamingMessage.reasoning || undefined,
        tool_calls: state.streamingMessage.tool_calls,
        render_payloads: state.streamingMessage.render_payloads,
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
      return {
        streamingMessage: { ...state.streamingMessage, tool_calls: newCalls },
      };
    }),

  addRenderPayload: (_messageId, payload) =>
    set((state) => {
      if (!state.streamingMessage) return state;
      return {
        streamingMessage: {
          ...state.streamingMessage,
          render_payloads: [...state.streamingMessage.render_payloads, payload],
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

  setStreamError: (err) => set({ streamError: err }),

  reset: () =>
    set({
      messages: [],
      streamingMessage: null,
      pendingConfirmations: [],
      isStreaming: false,
      streamError: null,
    }),
}));
