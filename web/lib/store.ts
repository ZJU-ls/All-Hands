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
  startStreaming: (messageId: string) => void;
  appendToken: (messageId: string, delta: string) => void;
  finalizeMessage: (msg: Message) => void;
  updateToolCall: (toolCall: ToolCall) => void;
  addRenderPayload: (messageId: string, payload: RenderPayload) => void;
  addConfirmation: (conf: PendingConfirmation) => void;
  removeConfirmation: (confirmationId: string) => void;
  stopStreaming: () => void;
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

  startStreaming: (messageId) =>
    set({
      isStreaming: true,
      streamError: null,
      streamingMessage: {
        id: messageId,
        role: "assistant",
        content: "",
        tool_calls: [],
        render_payloads: [],
        created_at: new Date().toISOString(),
      },
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

  finalizeMessage: (msg) =>
    set((state) => ({
      messages: [...state.messages, msg],
      streamingMessage: null,
      isStreaming: false,
    })),

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

  stopStreaming: () =>
    set({ isStreaming: false, streamingMessage: null }),

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
