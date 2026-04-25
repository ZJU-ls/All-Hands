/**
 * /skills/[id] detail page · Track F
 *
 * Coverage target (Track F spec §4):
 *   - loading state (before fetch resolves)
 *   - ready state (header + all 4 tabs reachable via click)
 *   - error state (fetch rejects)
 *   - notfound state (404 from GET /api/skills/{id})
 *
 * Network is stubbed by assigning to global.fetch; next/navigation.useParams
 * is mocked so the component resolves `id` synchronously. AppShell +
 * ConfirmDialog are swapped out to keep the DOM shallow.
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
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from "@/tests/test-utils/i18n-render";

vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

const paramsMock = { id: "skill.builtin.search" };
vi.mock("next/navigation", () => ({
  useParams: () => paramsMock,
}));

import SkillDetailPage from "@/app/skills/[id]/page";

type SkillShape = {
  id: string;
  name: string;
  description: string;
  tool_ids: string[];
  prompt_fragment: string | null;
  version: string;
  source: string;
  source_url: string | null;
  installed_at: string | null;
  path: string | null;
};

const skillFixture: SkillShape = {
  id: "skill.builtin.search",
  name: "search",
  description: "语义 + 关键词混合检索,返回 top-k。",
  tool_ids: ["allhands.builtin.search", "allhands.mcp.github.search"],
  prompt_fragment: "你可以使用 search 工具帮助用户查找信息。",
  version: "1.2.0",
  source: "builtin",
  source_url: "https://github.com/anthropics/skills/tree/main/skills/search",
  installed_at: "2026-04-18T00:00:00Z",
  path: "/app/data/skills/search",
};

const employeesFixture = [
  {
    id: "emp.lead",
    name: "领导员工",
    description: "",
    is_lead_agent: true,
    tool_ids: [],
    skill_ids: ["skill.builtin.search"],
    max_iterations: 12,
    model_ref: "openai:gpt-4o",
  },
  {
    id: "emp.analyst",
    name: "分析师",
    description: "",
    is_lead_agent: false,
    tool_ids: [],
    skill_ids: ["skill.builtin.search"],
    max_iterations: 8,
    model_ref: "openai:gpt-4o",
  },
  {
    id: "emp.writer",
    name: "写手",
    description: "",
    is_lead_agent: false,
    tool_ids: [],
    skill_ids: ["skill.builtin.summarize"],
    max_iterations: 8,
    model_ref: "openai:gpt-4o",
  },
];

type FetchInit = RequestInit | undefined;

let fetchSpy: MockInstance<
  (input: string | URL | Request, init?: FetchInit) => Promise<Response>
>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  paramsMock.id = "skill.builtin.search";
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function routeHappy() {
  fetchSpy.mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/skills/") && !url.includes("market")) {
      return jsonResponse(skillFixture);
    }
    if (url === "/api/employees") {
      return jsonResponse(employeesFixture);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe("/skills/[id] detail page", () => {
  it("renders loading state before the fetch resolves", async () => {
    let resolveSkill: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveSkill = resolve;
    });
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/skills/")) return pending;
      if (url === "/api/employees") return jsonResponse(employeesFixture);
      throw new Error(`unexpected fetch ${url}`);
    });

    render(<SkillDetailPage />);
    expect(screen.getByTestId("skill-detail-loading")).toBeDefined();

    resolveSkill(jsonResponse(skillFixture));
    await waitFor(() =>
      expect(screen.queryByTestId("skill-detail-loading")).toBeNull(),
    );
  });

  it("renders header + overview + switches through all four tabs", async () => {
    routeHappy();
    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId("skill-name")).toBeDefined());
    expect(screen.getByTestId("skill-name").textContent).toBe("search");
    expect(screen.getByTestId("skill-version").textContent).toBe("v1.2.0");

    // overview is default — 2 dependents (lead + analyst)
    expect(screen.getByTestId("tab-panel-overview")).toBeDefined();
    expect(screen.getByTestId("dependent-emp.lead")).toBeDefined();
    expect(screen.getByTestId("dependent-emp.analyst")).toBeDefined();
    expect(screen.queryByTestId("dependent-emp.writer")).toBeNull();

    fireEvent.click(screen.getByTestId("tab-prompt"));
    expect(screen.getByTestId("tab-panel-prompt")).toBeDefined();
    expect(screen.getByTestId("prompt-fragment").textContent).toContain(
      "search 工具",
    );

    fireEvent.click(screen.getByTestId("tab-versions"));
    expect(screen.getByTestId("tab-panel-versions")).toBeDefined();
    expect(screen.getByTestId("version-history-empty")).toBeDefined();

    fireEvent.click(screen.getByTestId("tab-dependencies"));
    expect(screen.getByTestId("tab-panel-dependencies")).toBeDefined();
    // 两个 tool_ids → 2 行,builtin + mcp 分类
    expect(
      screen.getByTestId("dep-row-allhands.builtin.search"),
    ).toBeDefined();
    expect(
      screen.getByTestId("dep-row-allhands.mcp.github.search"),
    ).toBeDefined();
  });

  it("shows ErrorState + retry when the skill fetch rejects", async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/skills/")) throw new Error("boom");
      if (url === "/api/employees") return jsonResponse(employeesFixture);
      throw new Error(`unexpected fetch ${url}`);
    });
    render(<SkillDetailPage />);
    await waitFor(() =>
      expect(screen.getByTestId("skill-detail-error")).toBeDefined(),
    );
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("shows EmptyState when the skill is 404", async () => {
    paramsMock.id = "skill.does-not-exist";
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/skills/")) {
        return jsonResponse({ detail: "Skill not found." }, 404);
      }
      if (url === "/api/employees") return jsonResponse(employeesFixture);
      throw new Error(`unexpected fetch ${url}`);
    });
    render(<SkillDetailPage />);
    await waitFor(() =>
      expect(screen.getByTestId("skill-detail-notfound")).toBeDefined(),
    );
    expect(screen.getByText(/skill.does-not-exist/)).toBeDefined();
  });
});
