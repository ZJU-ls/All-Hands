/**
 * MessageList · Track α sticky-bottom autoscroll.
 *
 * Behavior contract:
 *   - New messages land at the bottom → scrollTo(bottom) is called.
 *   - User scrolls away → no more autoscroll until they either scroll back or
 *     click the jump-to-bottom button.
 *   - The jump-to-bottom button only surfaces while not stuck to bottom.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MessageList } from "../MessageList";
import { useChatStore } from "@/lib/store";

// A plausible scrollable viewport; jsdom otherwise reports 0 for every
// layout geometry and makes "isAtBottom" ambiguous.
const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 400;

function primeScrollGeometry(scrollTop: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return SCROLL_HEIGHT;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return CLIENT_HEIGHT;
    },
  });
  let currentTop = scrollTop;
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get() {
      return currentTop;
    },
    set(v) {
      currentTop = v;
    },
  });
}

const scrollToSpy = vi.fn();

beforeEach(() => {
  scrollToSpy.mockReset();
  HTMLElement.prototype.scrollTo = scrollToSpy as typeof HTMLElement.prototype.scrollTo;
  // reset store between tests
  useChatStore.setState({
    messages: [],
    streamingMessage: null,
    isStreaming: false,
    pendingConfirmations: [],
    streamError: null,
  });
});

afterEach(() => {
  cleanup();
  // best-effort cleanup of the prototype stubs
  // @ts-expect-error — deleting prototype property stubbed in primeScrollGeometry
  delete HTMLElement.prototype.scrollHeight;
  // @ts-expect-error — deleting prototype property stubbed in primeScrollGeometry
  delete HTMLElement.prototype.clientHeight;
  // @ts-expect-error — deleting prototype property stubbed in primeScrollGeometry
  delete HTMLElement.prototype.scrollTop;
});

describe("MessageList · Track α · sticky-bottom autoscroll", () => {
  it("auto-scrolls to bottom when a new message lands and the user is at bottom", () => {
    primeScrollGeometry(SCROLL_HEIGHT - CLIENT_HEIGHT); // at bottom

    render(<MessageList conversationId="c1" />);

    act(() => {
      useChatStore.setState({
        messages: [
          {
            id: "m1",
            conversation_id: "c1",
            role: "user",
            content: "hi",
            tool_calls: [],
            render_payloads: [],
            created_at: "2026-04-20T00:00:00Z",
            tool_call_id: null,
            trace_ref: null,
            parent_run_id: null,
          },
        ],
      });
    });

    expect(scrollToSpy).toHaveBeenCalled();
    expect(screen.queryByTestId("jump-to-bottom")).toBeNull();
  });

  it("stops auto-scrolling once the user scrolls up, surfaces the jump button", () => {
    primeScrollGeometry(100); // way above bottom

    render(<MessageList conversationId="c1" />);
    const scrollArea = screen.getByTestId("message-list-scroll");

    // simulate user scroll → should flip stickToBottom off
    fireEvent.scroll(scrollArea);

    scrollToSpy.mockClear();

    act(() => {
      useChatStore.setState({
        messages: [
          {
            id: "m2",
            conversation_id: "c1",
            role: "assistant",
            content: "streaming token",
            tool_calls: [],
            render_payloads: [],
            created_at: "2026-04-20T00:00:01Z",
            tool_call_id: null,
            trace_ref: null,
            parent_run_id: null,
          },
        ],
      });
    });

    // not at bottom → no new scrollTo
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("jump-to-bottom")).toBeDefined();
  });

  it("renders streamError inline when a run fails (regression: 试用 没有任何反应)", () => {
    // When the backend emits RUN_ERROR (e.g. seed provider with no api key →
    // 401 from upstream), the chat store lifts the failure into
    // `streamError`. The MessageList has to surface that banner inline or
    // the user just sees their own message echoed and nothing else.
    primeScrollGeometry(SCROLL_HEIGHT - CLIENT_HEIGHT);
    render(<MessageList conversationId="c1" />);

    act(() => {
      useChatStore.setState({
        streamError: {
          message: "upstream 401: invalid api key",
          code: "INTERNAL",
        },
      });
    });

    const banner = screen.getByTestId("message-list-stream-error");
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain("助手没能完成这次回复");
    expect(banner.textContent).toContain("upstream 401");
    expect(banner.textContent).toContain("[INTERNAL]");
  });

  it("suppresses streamError banner while a reply is actively streaming", () => {
    // Defensive: if the store picks up a stale error from the previous turn
    // but a new assistant reply is already streaming, render the reply — not
    // the old error — so the user sees progress, not a contradiction.
    primeScrollGeometry(SCROLL_HEIGHT - CLIENT_HEIGHT);
    render(<MessageList conversationId="c1" />);

    act(() => {
      useChatStore.setState({
        streamError: { message: "old failure" },
        streamingMessage: {
          id: "stream-1",
          role: "assistant",
          content: "partial …",
          reasoning: "",
          tool_calls: [],
          render_payloads: [],
          created_at: "2026-04-20T00:00:00Z",
        },
      });
    });

    expect(screen.queryByTestId("message-list-stream-error")).toBeNull();
  });

  it("shows a pending-assistant bubble between send and first frame", () => {
    // Post-send / pre-first-token gap: the user has hit submit, `isStreaming`
    // was flipped to `true` by `beginTurn`, but no TEXT_MESSAGE_START /
    // REASONING_MESSAGE_START frame has arrived yet. Without the placeholder
    // the panel looks dead ("像是没连接上") for the whole POST round-trip.
    primeScrollGeometry(SCROLL_HEIGHT - CLIENT_HEIGHT);
    render(<MessageList conversationId="c1" />);

    act(() => {
      useChatStore.setState({
        isStreaming: true,
        streamingMessage: null,
        messages: [
          {
            id: "u1",
            conversation_id: "c1",
            role: "user",
            content: "hi",
            tool_calls: [],
            render_payloads: [],
            created_at: "2026-04-20T00:00:00Z",
            tool_call_id: null,
            trace_ref: null,
            parent_run_id: null,
          },
        ],
      });
    });

    expect(screen.getByTestId("pending-assistant-bubble")).toBeDefined();

    // First frame arrives → placeholder goes away, real streaming bubble takes over.
    act(() => {
      useChatStore.setState({
        streamingMessage: {
          id: "stream-1",
          role: "assistant",
          content: "hi",
          reasoning: "",
          tool_calls: [],
          render_payloads: [],
          created_at: "2026-04-20T00:00:01Z",
        },
      });
    });
    expect(screen.queryByTestId("pending-assistant-bubble")).toBeNull();
  });

  it("preserves reasoning accumulated before TEXT_MESSAGE_START", () => {
    // Bug: REASONING_MESSAGE_CHUNK typically fires before the first text
    // token. Those chunks seed `streamingMessage` via appendReasoning. Then
    // TEXT_MESSAGE_START arrives and calls startStreaming — which used to
    // reset streamingMessage to an empty shell, wiping the accumulated
    // reasoning buffer. hasReasoning then flipped to false mid-turn and the
    // panel disappeared, which the user saw as "思考过程展示完之后会隐藏".
    primeScrollGeometry(SCROLL_HEIGHT - CLIENT_HEIGHT);
    render(<MessageList conversationId="c1" />);

    const store = useChatStore.getState();
    act(() => {
      store.appendReasoning("msg-A", "first thought. ");
      store.appendReasoning("msg-A", "second thought.");
      // TEXT_MESSAGE_START would fire next — this is the moment the old
      // implementation wiped `reasoning` back to empty string.
      store.startStreaming("msg-A");
      store.appendToken("msg-A", "final answer");
    });

    const snapshot = useChatStore.getState().streamingMessage;
    expect(snapshot?.reasoning).toBe("first thought. second thought.");
    expect(snapshot?.content).toBe("final answer");

    // The reasoning panel must also still be mounted (hasReasoning=true)
    // after TEXT_MESSAGE_START — the DOM-visible proof of the regression.
    const toggle = screen.getByTestId("reasoning-toggle");
    expect(toggle.textContent).toContain(
      String("first thought. second thought.".length),
    );
  });

  it("keeps the reasoning panel open across the streaming → finalized transition", () => {
    // Bug: "思考过程展示完之后会隐藏" — ReasoningBlock's `open` state is a
    // `useState(isStreaming)`; if the bubble unmounts/remounts when the
    // streaming message is promoted into `messages[]`, the state resets to
    // the new mount's `isStreaming=false` default and the panel collapses.
    // Fix is in MessageList: render streaming + finalized bubbles under the
    // same message-id key so React reconciles instead of remounting.
    primeScrollGeometry(SCROLL_HEIGHT - CLIENT_HEIGHT);
    render(<MessageList conversationId="c1" />);

    act(() => {
      useChatStore.setState({
        isStreaming: true,
        streamingMessage: {
          id: "a1",
          role: "assistant",
          content: "",
          reasoning: "thinking…",
          tool_calls: [],
          render_payloads: [],
          created_at: "2026-04-20T00:00:00Z",
        },
      });
    });

    // Streaming: reasoning block is mounted, `aria-expanded=true` (default
    // open while streaming with no content yet).
    const toggleBefore = screen.getByTestId("reasoning-toggle");
    expect(toggleBefore.getAttribute("aria-expanded")).toBe("true");

    // Simulate finalizeStreaming: move the in-flight message into messages[]
    // and clear streamingMessage in one atomic setState (same as the real
    // store action).
    act(() => {
      useChatStore.setState((s) => ({
        messages: [
          ...s.messages,
          {
            id: "a1",
            conversation_id: "c1",
            role: "assistant",
            content: "final answer",
            reasoning: "thinking…",
            tool_calls: [],
            render_payloads: [],
            created_at: "2026-04-20T00:00:00Z",
            tool_call_id: null,
            trace_ref: null,
            parent_run_id: null,
          },
        ],
        streamingMessage: null,
        isStreaming: false,
      }));
    });

    // If the bubble remounted, the new instance would default to collapsed
    // (isStreaming prop is false on a historical message). Assert it stays
    // open — proof that reconciliation preserved the `open` useState.
    const toggleAfter = screen.getByTestId("reasoning-toggle");
    expect(toggleAfter.getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking jump-to-bottom scrolls + re-arms sticky autoscroll", () => {
    primeScrollGeometry(100);

    render(<MessageList conversationId="c1" />);

    // Seed with a message so the button can appear.
    act(() => {
      useChatStore.setState({
        messages: [
          {
            id: "m3",
            conversation_id: "c1",
            role: "user",
            content: "hi",
            tool_calls: [],
            render_payloads: [],
            created_at: "2026-04-20T00:00:00Z",
            tool_call_id: null,
            trace_ref: null,
            parent_run_id: null,
          },
        ],
      });
    });

    const scrollArea = screen.getByTestId("message-list-scroll");
    fireEvent.scroll(scrollArea);
    const jump = screen.getByTestId("jump-to-bottom");
    scrollToSpy.mockClear();
    fireEvent.click(jump);

    expect(scrollToSpy).toHaveBeenCalled();
    expect(screen.queryByTestId("jump-to-bottom")).toBeNull();
  });
});
