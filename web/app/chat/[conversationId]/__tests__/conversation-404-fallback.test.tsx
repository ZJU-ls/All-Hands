/**
 * /chat/[conversationId] · B05 silent fallback
 *
 * When the conversation id in the URL is stale (404 from backend — usually a
 * pointer left in localStorage after a db reset), the page must:
 *   1. NOT render the red "连接错误" card
 *   2. Call localStorage.removeItem("allhands_conversation_id")
 *   3. router.replace("/chat") — landing page re-mints a fresh conversation
 *
 * A 500 (true backend error) still renders the error card.
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

  it("still surfaces the error card for non-404 backend errors", async () => {
    fetchSpy.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations/")) {
        return new Response("", { status: 500, statusText: "Server Error" });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<ConversationPage />);

    await waitFor(() =>
      expect(screen.getByText(/getConversation failed: 500/)).toBeDefined(),
    );
    expect(replaceMock).not.toHaveBeenCalled();
    // Stale id is NOT evicted on 500 — it might be a transient server issue.
    expect(localStorage.getItem("allhands_conversation_id")).toBe("stale-uuid");
  });
});
