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
