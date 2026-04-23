import { test } from "@playwright/test";

/**
 * Product-level self-drive screenshots for the 2026-04-22 cockpit
 * redesign. Not a regression test — serves only as the 阶段 4.5 验收包
 * evidence (L02: Playwright alone isn't 产品验收, but headed-mode PNGs
 * are the closest substitute when chrome-devtools MCP is unavailable).
 *
 * Writes PNGs to plans/screenshots/cockpit-redesign/*.png · that
 * directory is gitignored (plans/ is personal tracking).
 */

const SNAP_DIR = "../plans/screenshots/cockpit-redesign";

type Summary = Record<string, unknown>;

function snapshot(overrides: Partial<Summary> = {}): Summary {
  return {
    employees_total: 4,
    runs_active: 2,
    conversations_today: 7,
    artifacts_total: 23,
    artifacts_this_week_delta: 6,
    triggers_active: 3,
    tasks_active: 5,
    tasks_needs_user: 1,
    tokens_today_total: 42_318,
    tokens_today_prompt: 28_400,
    tokens_today_completion: 13_918,
    estimated_cost_today_usd: 1.84,
    health: {
      gateway: { name: "gateway", status: "ok", detail: "2 providers" },
      mcp_servers: { name: "mcp", status: "ok", detail: "3 servers" },
      langfuse: { name: "langfuse", status: "ok", detail: null },
      db: { name: "db", status: "ok", detail: "reachable" },
      triggers: { name: "triggers", status: "ok", detail: "3 active" },
    },
    confirmations_pending: 2,
    runs_failing_recently: 0,
    recent_events: [
      {
        id: "e1",
        ts: new Date(Date.now() - 5_000).toISOString(),
        severity: "info",
        kind: "run.started",
        actor: "emp_lead",
        subject: null,
        summary: "Lead 启动任务调度",
        link: null,
      },
      {
        id: "e2",
        ts: new Date(Date.now() - 45_000).toISOString(),
        severity: "info",
        kind: "tool.called",
        actor: "emp_researcher",
        subject: "search_web",
        summary: "research agent 调用 search_web",
        link: null,
      },
      {
        id: "e3",
        ts: new Date(Date.now() - 120_000).toISOString(),
        severity: "warn",
        kind: "confirmation.pending",
        actor: "emp_writer",
        subject: null,
        summary: "writer 请求确认 publish_article",
        link: null,
      },
      {
        id: "e4",
        ts: new Date(Date.now() - 300_000).toISOString(),
        severity: "info",
        kind: "run.completed",
        actor: "emp_researcher",
        subject: null,
        summary: "research 完成 · 6 条摘要",
        link: null,
      },
      {
        id: "e5",
        ts: new Date(Date.now() - 600_000).toISOString(),
        severity: "error",
        kind: "tool.errored",
        actor: "emp_writer",
        subject: "fetch_url",
        summary: "fetch_url 超时 · 已重试 2 次",
        link: null,
      },
    ],
    active_runs: [
      {
        run_id: "run_01",
        employee_id: "emp_lead",
        employee_name: "Lead",
        status: "thinking",
        current_action_summary: "分析本周汇报需求 · 拆解子任务",
        iteration: 3,
        max_iterations: 10,
        parent_run_id: null,
        depth: 0,
        started_at: new Date(Date.now() - 90_000).toISOString(),
        trigger_id: null,
      },
      {
        run_id: "run_02",
        employee_id: "emp_researcher",
        employee_name: "Researcher",
        status: "calling_tool",
        current_action_summary: "call tool search_web · query: Q1 营收数据",
        iteration: 2,
        max_iterations: 8,
        parent_run_id: "run_01",
        depth: 1,
        started_at: new Date(Date.now() - 60_000).toISOString(),
        trigger_id: null,
      },
    ],
    recent_conversations: [
      {
        id: "c1",
        title: "Q1 汇报大纲",
        employee_id: "emp_lead",
        employee_name: "Lead",
        updated_at: new Date().toISOString(),
        message_count: 8,
      },
      {
        id: "c2",
        title: "产品命名 brainstorm",
        employee_id: "emp_writer",
        employee_name: "Writer",
        updated_at: new Date(Date.now() - 7200_000).toISOString(),
        message_count: 14,
      },
    ],
    paused: false,
    paused_reason: null,
    paused_at: null,
    ...overrides,
  };
}

test.describe("cockpit · snapshot", () => {
  test("captures light + dark + drawer + paused states", async ({ page }) => {
    await page.route("**/api/cockpit/summary", async (route) => {
      await route.fulfill({ json: snapshot() });
    });
    await page.route("**/api/cockpit/stream", async (route) => {
      await route.fulfill({ status: 404, body: "" });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("[data-testid=cockpit-hud]");
    await page.screenshot({ path: `${SNAP_DIR}/01-light-full.png`, fullPage: false });

    // Open Budget drawer
    await page.getByTestId("rail-budget").click();
    await page.waitForSelector("[data-testid=cockpit-drawer-budget]");
    await page.waitForTimeout(250); // let the fade-in settle before snapshot
    await page.screenshot({ path: `${SNAP_DIR}/02-light-drawer-budget.png` });

    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-testid=cockpit-drawer-budget]", {
      state: "detached",
    });

    // Open Health drawer
    await page.getByTestId("rail-health").click();
    await page.waitForSelector("[data-testid=cockpit-drawer-health]");
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SNAP_DIR}/03-light-drawer-health.png` });

    await page.keyboard.press("Escape");

    // Switch to dark · the init script in layout.tsx reads
    // `allhands_theme` from localStorage BEFORE React hydrates, so we set
    // it and reload rather than mutating classList (ThemeProvider would
    // otherwise re-assert its current state on hydration).
    await page.evaluate(() => {
      localStorage.setItem("allhands_theme", "dark");
    });
    await page.reload();
    await page.waitForSelector("[data-testid=cockpit-hud]");
    await page.screenshot({ path: `${SNAP_DIR}/04-dark-full.png` });

    // Open Convs drawer in dark
    await page.getByTestId("rail-convs").click();
    await page.waitForSelector("[data-testid=cockpit-drawer-convs]");
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SNAP_DIR}/05-dark-drawer-convs.png` });
  });

  test("captures paused HUD state", async ({ page }) => {
    await page.route("**/api/cockpit/summary", async (route) => {
      await route.fulfill({
        json: snapshot({
          paused: true,
          paused_reason: "维护窗口 · 12:00-13:00",
          paused_at: new Date().toISOString(),
        }),
      });
    });
    await page.route("**/api/cockpit/stream", async (route) => {
      await route.fulfill({ status: 404, body: "" });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForSelector("[data-testid=cockpit-hud]");
    await page.screenshot({ path: `${SNAP_DIR}/06-light-paused.png` });
  });
});
