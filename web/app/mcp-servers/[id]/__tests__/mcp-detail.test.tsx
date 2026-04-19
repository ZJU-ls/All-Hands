/**
 * /mcp-servers/[id] detail page · Track F
 *
 * Coverage target (Track F spec §4):
 *   - loading state (before fetch resolves)
 *   - ready state (header + all 4 tabs reachable, tools tab lazy-loads)
 *   - error state (server fetch rejects)
 *   - notfound state (404 from GET /api/mcp-servers/{id})
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
} from "@testing-library/react";

vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

const paramsMock = { id: "mcp.github" };
vi.mock("next/navigation", () => ({
  useParams: () => paramsMock,
}));

import McpServerDetailPage from "@/app/mcp-servers/[id]/page";

const serverFixture = {
  id: "mcp.github",
  name: "github",
  transport: "stdio" as const,
  config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
  enabled: true,
  exposed_tool_ids: ["allhands.mcp.github.search", "allhands.mcp.github.create_issue"],
  last_handshake_at: "2026-04-19T01:00:00Z",
  health: "ok" as const,
};

const employeesFixture = [
  {
    id: "emp.lead",
    name: "领导员工",
    description: "",
    is_lead_agent: true,
    tool_ids: ["allhands.mcp.github.search"],
    skill_ids: [],
    max_iterations: 12,
    model_ref: "openai:gpt-4o",
  },
  {
    id: "emp.writer",
    name: "写手",
    description: "",
    is_lead_agent: false,
    tool_ids: ["allhands.builtin.fetch"],
    skill_ids: [],
    max_iterations: 6,
    model_ref: "openai:gpt-4o",
  },
];

const toolsFixture = [
  {
    name: "search",
    description: "Search GitHub issues",
    input_schema: { type: "object", properties: { q: { type: "string" } } },
  },
  {
    name: "create_issue",
    description: "File a new issue",
    input_schema: { type: "object", properties: { title: { type: "string" } } },
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
  paramsMock.id = "mcp.github";
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function routeHappy() {
  fetchSpy.mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/employees") return jsonResponse(employeesFixture);
    if (url.match(/^\/api\/mcp-servers\/[^/]+\/tools$/)) {
      return jsonResponse(toolsFixture);
    }
    if (url.match(/^\/api\/mcp-servers\/[^/]+$/)) {
      return jsonResponse(serverFixture);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe("/mcp-servers/[id] detail page", () => {
  it("renders loading state before the fetch resolves", async () => {
    let resolveServer: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveServer = resolve;
    });
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/employees") return jsonResponse(employeesFixture);
      if (url.match(/^\/api\/mcp-servers\/[^/]+$/)) return pending;
      throw new Error(`unexpected fetch ${url}`);
    });
    render(<McpServerDetailPage />);
    expect(screen.getByTestId("mcp-detail-loading")).toBeDefined();
    resolveServer(jsonResponse(serverFixture));
    await waitFor(() =>
      expect(screen.queryByTestId("mcp-detail-loading")).toBeNull(),
    );
  });

  it("renders header + overview + switches through all four tabs, lazy-loading tools", async () => {
    routeHappy();
    render(<McpServerDetailPage />);

    await waitFor(() => expect(screen.getByTestId("mcp-name")).toBeDefined());
    expect(screen.getByTestId("mcp-name").textContent).toBe("github");
    expect(screen.getByTestId("mcp-transport").textContent).toBe("stdio");
    // only emp.lead uses an exposed tool
    expect(screen.getByTestId("dependent-emp.lead")).toBeDefined();
    expect(screen.queryByTestId("dependent-emp.writer")).toBeNull();

    // overview is default
    expect(screen.getByTestId("tab-panel-overview")).toBeDefined();
    expect(screen.getByTestId("mcp-config-pre").textContent).toContain("npx");

    // tools tab lazy-fetches
    fireEvent.click(screen.getByTestId("tab-tools"));
    expect(screen.getByTestId("tab-panel-tools")).toBeDefined();
    await waitFor(() =>
      expect(screen.getByTestId("tools-table")).toBeDefined(),
    );
    expect(screen.getByTestId("tool-row-search")).toBeDefined();
    expect(screen.getByTestId("tool-row-create_issue")).toBeDefined();

    // expand schema
    fireEvent.click(
      screen.getByTestId("tool-row-search").querySelector("button")!,
    );
    expect(screen.getByTestId("tool-schema-search").textContent).toContain(
      "properties",
    );

    // logs tab → empty placeholder
    fireEvent.click(screen.getByTestId("tab-logs"));
    expect(screen.getByTestId("logs-empty")).toBeDefined();

    // health tab → single-row table + placeholder
    fireEvent.click(screen.getByTestId("tab-health"));
    expect(screen.getByTestId("health-table-body")).toBeDefined();
    expect(
      screen.getByTestId("health-timeline-placeholder"),
    ).toBeDefined();
  });

  it("shows ErrorState + retry when the server fetch rejects", async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/employees") return jsonResponse(employeesFixture);
      if (url.match(/^\/api\/mcp-servers\/[^/]+$/)) {
        throw new Error("boom");
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    render(<McpServerDetailPage />);
    await waitFor(() =>
      expect(screen.getByTestId("mcp-detail-error")).toBeDefined(),
    );
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("shows EmptyState when the server is 404", async () => {
    paramsMock.id = "mcp.ghost";
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/employees") return jsonResponse(employeesFixture);
      if (url.match(/^\/api\/mcp-servers\/[^/]+$/)) {
        return jsonResponse({ detail: "MCP server not found." }, 404);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    render(<McpServerDetailPage />);
    await waitFor(() =>
      expect(screen.getByTestId("mcp-detail-notfound")).toBeDefined(),
    );
    expect(screen.getByText(/mcp\.ghost/)).toBeDefined();
  });
});
