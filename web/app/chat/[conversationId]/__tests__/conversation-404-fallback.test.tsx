/**
 * /chat/[conversationId] · B05 silent fallback + E14 backend-offline state
 *
 * When the conversation id in the URL is stale (404 from backend — usually a
 * pointer left in localStorage after a db reset), the page must:
 *   1. NOT render the red "连接错误" card
 *   2. Call localStorage.removeItem("allhands_conversation_id")
 *   3. router.replace("/chat") — landing page re-mints a fresh conversation
 *
 * A 500 **with non-JSON body** means uvicorn is offline (Next dev's rewrite
 * returns plain "Internal Server Error"); instead of a red banner we render a
 * "后端未就绪 · 自动重连" state. See learnings L07 / error-patterns E14.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";

const paramsMock = { conversationId: "stale-uuid" };
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => paramsMock,
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({
    children,
    actions,
  }: {
    children: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));
vi.mock("@/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="mock-message-list" />,
}));
vi.mock("@/components/chat/InputBar", () => ({
  InputBar: () => <div data-testid="mock-input-bar" />,
}));
vi.mock("@/components/chat/ConfirmationDialog", () => ({
  ConfirmationDialog: () => null,
}));
vi.mock("@/components/chat/ConversationHeader", () => ({
  ConversationHeader: () => <div data-testid="mock-header" />,
}));
vi.mock("@/components/artifacts/ArtifactPanel", () => ({
  ArtifactPanel: () => null,
}));

import ConversationPage from "@/app/chat/[conversationId]/page";

type FetchInit = RequestInit | undefined;
let fetchSpy: MockInstance<
  (input: string | URL | Request, init?: FetchInit) => Promise<Response>
>;

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key) => (storage.has(key) ? storage.get(key)! : null),
  setItem: (key, value) => {
    storage.set(key, String(value));
  },
  removeItem: (key) => {
    storage.delete(key);
  },
  clear: () => storage.clear(),
  key: (i) => Array.from(storage.keys())[i] ?? null,
  get length() {
    return storage.size;
  },
};

beforeEach(() => {
  paramsMock.conversationId = "stale-uuid";
  replaceMock.mockReset();
  storage.clear();
  vi.stubGlobal("localStorage", localStorageMock);
  localStorage.setItem("allhands_conversation_id", "stale-uuid");
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  storage.clear();
});

describe("/chat/[conversationId] · B05 stale-id silent fallback", () => {
  it("evicts the stored id and bounces to /chat when getConversation 404s", async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations/")) {
        return new Response("", { status: 404, statusText: "Not Found" });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<ConversationPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/chat"));
    expect(localStorage.getItem("allhands_conversation_id")).toBeNull();
    // No red error card should have been rendered for the 404 path.
    expect(screen.queryByText(/连接错误/)).toBeNull();
  });

  it("renders the backend-offline banner (not a raw 500) when uvicorn is down (E14)", async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations/")) {
        // Next.js dev proxy returns plain-text 500 when upstream is unreachable.
        return new Response("Internal Server Error", {
          status: 500,
          headers: { "content-type": "text/plain" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<ConversationPage />);

    await waitFor(() =>
      expect(screen.getByTestId("backend-offline-banner")).toBeDefined(),
    );
    // The old raw "getConversation failed: 500" string must NOT appear — that's
    // the unfriendly UX this fix replaces.
    expect(screen.queryByText(/getConversation failed: 500/)).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
    // Stale id is NOT evicted — the backend might come back in a moment.
    expect(localStorage.getItem("allhands_conversation_id")).toBe("stale-uuid");
  });

  it("surfaces the red error card for a real JSON 500 (application error)", async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations/")) {
        return new Response(JSON.stringify({ detail: "db connection lost" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<ConversationPage />);

    await waitFor(() =>
      expect(screen.getByText(/getConversation failed: 500/)).toBeDefined(),
    );
    expect(screen.queryByTestId("backend-offline-banner")).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("allhands_conversation_id")).toBe("stale-uuid");
  });
});
