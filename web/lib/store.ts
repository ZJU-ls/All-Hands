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

type ChatState = {
  conversationId: string | null;
  messages: Message[];
  streamingMessage: StreamingMessage | null;
  pendingConfirmations: PendingConfirmation[];
  isStreaming: boolean;

  setConversationId: (id: string) => void;
  addMessage: (msg: Message) => void;
  startStreaming: (messageId: string) => void;
  appendToken: (messageId: string, delta: string) => void;
  finalizeMessage: (msg: Message) => void;
  updateToolCall: (toolCall: ToolCall) => void;
  addRenderPayload: (messageId: string, payload: RenderPayload) => void;
  addConfirmation: (conf: PendingConfirmation) => void;
  removeConfirmation: (confirmationId: string) => void;
  stopStreaming: () => void;
  reset: () => void;
};

export const useChatStore = create<ChatState>((set) => ({
  conversationId: null,
  messages: [],
  streamingMessage: null,
  pendingConfirmations: [],
  isStreaming: false,

  setConversationId: (id) => set({ conversationId: id }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  startStreaming: (messageId) =>
    set({
      isStreaming: true,
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

  reset: () =>
    set({
      messages: [],
      streamingMessage: null,
      pendingConfirmations: [],
      isStreaming: false,
    }),
}));
