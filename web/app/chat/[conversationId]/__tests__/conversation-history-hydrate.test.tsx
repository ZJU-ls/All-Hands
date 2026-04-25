/**
 * /chat/[conversationId] · 历史渲染 rehydrate
 *
 * Bug前:打开一个带有 render 产物的历史对话 → 图表、卡片、表格全部消失,
 * 只剩一段文字。原因两层:
 *   1. 后端 ChatMessageResponse 主动不返回 render_payloads / tool_calls / reasoning
 *   2. 前端 page.tsx:114-115 把这些字段 hardcode 成 []
 *
 * 这里只验证前端的一半 —— API mock 返回完整字段 → replaceMessages 收到的
 * Message 必须带着 render_payloads / tool_calls / reasoning,否则 MessageList
 * 无从还原历史视觉态。后端的一半由 tests/integration/test_conversation_compact.py
 * 守。
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
import { render, cleanup, waitFor } from "@/tests/test-utils/i18n-render";
import type { Message } from "@/lib/protocol";

const paramsMock = { conversationId: "conv-with-render" };
const replaceMessagesSpy = vi.fn<(msgs: Message[]) => void>();

vi.mock("next/navigation", () => ({
  useParams: () => paramsMock,
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
vi.mock("@/components/chat/UserInputDialog", () => ({
  UserInputDialog: () => null,
}));
vi.mock("@/components/chat/ProgressPanel", () => ({
  ProgressPanel: () => null,
}));
vi.mock("@/components/chat/ConversationHeader", () => ({
  ConversationHeader: () => <div data-testid="mock-header" />,
}));
vi.mock("@/components/chat/ConversationSwitcher", () => ({
  ConversationSwitcher: () => null,
}));
vi.mock("@/components/artifacts/ArtifactPanel", () => ({
  ArtifactPanel: () => null,
}));

// The page pulls replaceMessages via a selector; we intercept it at the hook
// boundary so the tap sees exactly what the page hands to the store.
vi.mock("@/lib/store", () => ({
  useChatStore: (
    selector: (s: { replaceMessages: typeof replaceMessagesSpy; reset: () => void }) => unknown,
  ) => selector({ replaceMessages: replaceMessagesSpy, reset: () => {} }),
}));

import ConversationPage from "@/app/chat/[conversationId]/page";

type FetchInit = RequestInit | undefined;
let fetchSpy: MockInstance<
  (input: string | URL | Request, init?: FetchInit) => Promise<Response>
>;

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  replaceMessagesSpy.mockReset();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("/chat/[conversationId] · 历史渲染 rehydrate", () => {
  it("hydrates render_payloads / tool_calls / reasoning from GET /messages into the store", async () => {
    const conversation = {
      id: "conv-with-render",
      employee_id: "emp1",
      title: null,
      model_ref_override: null,
      created_at: "2026-04-22T00:00:00+00:00",
    };
    const employee = {
      id: "emp1",
      name: "hydrate-test",
      description: "",
      tool_ids: [],
      skill_ids: [],
      model_ref: "default",
      is_lead_agent: false,
      system_prompt: "",
      max_iterations: 10,
      created_at: "2026-04-22T00:00:00+00:00",
    };
    const messages = [
      {
        id: "m1",
        conversation_id: "conv-with-render",
        role: "user",
        content: "画一张柱状图",
        created_at: "2026-04-22T00:00:00+00:00",
        render_payloads: [],
        tool_calls: [],
        reasoning: null,
      },
      {
        id: "m2",
        conversation_id: "conv-with-render",
        role: "assistant",
        content: "这是你要的柱状图:",
        created_at: "2026-04-22T00:00:01+00:00",
        render_payloads: [
          {
            component: "BarChart",
            props: { bars: [{ label: "a", value: 1 }] },
            interactions: [],
          },
        ],
        tool_calls: [
          {
            id: "tc1",
            tool_id: "allhands.render.bar_chart",
            args: {},
            status: "succeeded",
            result: null,
          },
        ],
        reasoning: "decided BarChart was the right component",
      },
    ];

    fetchSpy.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/conversations/conv-with-render")) {
        return okJson(conversation);
      }
      if (url.includes("/api/conversations/conv-with-render/messages")) {
        return okJson(messages);
      }
      if (url.endsWith("/api/employees/emp1")) {
        return okJson(employee);
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<ConversationPage />);

    await waitFor(() => expect(replaceMessagesSpy).toHaveBeenCalled());
    const lastCall = replaceMessagesSpy.mock.calls.at(-1);
    if (!lastCall) throw new Error("replaceMessages was never invoked");
    const [hydrated] = lastCall;
    expect(hydrated).toHaveLength(2);

    const assistant = hydrated.find((m) => m.role === "assistant");
    if (!assistant) throw new Error("assistant row must be present in hydrated state");
    expect(assistant.render_payloads, "render_payloads dropped → charts vanish on reload").toHaveLength(1);
    const [firstRender] = assistant.render_payloads;
    expect(firstRender?.component).toBe("BarChart");
    expect(assistant.tool_calls, "tool_calls dropped → inline system-tool chips vanish (L14)").toHaveLength(1);
    const [firstTc] = assistant.tool_calls;
    expect(firstTc?.tool_id).toBe("allhands.render.bar_chart");
    expect(assistant.reasoning).toBe("decided BarChart was the right component");
  });
});
