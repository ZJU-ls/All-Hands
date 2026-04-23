import { test, expect } from "@playwright/test";

/**
 * Cockpit smoke — HUD + KPI console + 2-column flight + DrawerRail.
 *
 * Backend mocks:
 *   - `/api/cockpit/summary` → initial-paint snapshot
 *   - `/api/cockpit/stream` → 404 so we exercise the error-banner branch
 *     without keeping an EventSource open (simpler + deterministic).
 *   - `/api/cockpit/pause-all|resume-all` for the 急停/resume flow.
 *
 * Asserts the post-2026-04-22 layout: definition-class flows (new
 * employee / trigger) are GONE; view+control flows (HUD ops, drawer
 * rail) are in.
 */

type Summary = {
  employees_total: number;
  runs_active: number;
  conversations_today: number;
  artifacts_total: number;
  artifacts_this_week_delta: number;
  triggers_active: number;
  tasks_active: number;
  tasks_needs_user: number;
  tokens_today_total: number;
  tokens_today_prompt: number;
  tokens_today_completion: number;
  estimated_cost_today_usd: number;
  health: Record<string, { name: string; status: string; detail: string | null }>;
  confirmations_pending: number;
  runs_failing_recently: number;
  recent_events: Array<Record<string, unknown>>;
  active_runs: Array<Record<string, unknown>>;
  recent_conversations: Array<Record<string, unknown>>;
  paused: boolean;
  paused_reason: string | null;
  paused_at: string | null;
};

function baseSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    employees_total: 3,
    runs_active: 1,
    conversations_today: 5,
    artifacts_total: 12,
    artifacts_this_week_delta: 4,
    triggers_active: 2,
    tasks_active: 0,
    tasks_needs_user: 0,
    tokens_today_total: 12_345,
    tokens_today_prompt: 8_000,
    tokens_today_completion: 4_345,
    estimated_cost_today_usd: 0.42,
    health: {
      gateway: { name: "gateway", status: "ok", detail: "2 providers" },
      mcp_servers: { name: "mcp", status: "ok", detail: "3 servers" },
      langfuse: { name: "langfuse", status: "ok", detail: null },
      db: { name: "db", status: "ok", detail: "reachable" },
      triggers: { name: "triggers", status: "ok", detail: "2 active" },
    },
    confirmations_pending: 0,
    runs_failing_recently: 0,
    recent_events: [
      {
        id: "e1",
        ts: new Date().toISOString(),
        severity: "info",
        kind: "run.started",
        actor: "emp_1",
        subject: null,
        summary: "Lead 开始处理",
        link: null,
      },
    ],
    active_runs: [],
    recent_conversations: [
      {
        id: "c1",
        title: "设计今日团队",
        employee_id: "emp_1",
        employee_name: "Lead",
        updated_at: new Date().toISOString(),
        message_count: 3,
      },
    ],
    paused: false,
    paused_reason: null,
    paused_at: null,
    ...overrides,
  };
}

async function stubBackend(page: import("@playwright/test").Page, summary: Summary) {
  await page.route("**/api/cockpit/summary", async (route) => {
    await route.fulfill({ json: summary });
  });
  // Force SSE to fail so the test doesn't hold the connection open —
  // Cockpit falls back to the initial-paint summary and shows a
  // reconnect banner. We assert on the snapshot content below.
  await page.route("**/api/cockpit/stream", async (route) => {
    await route.fulfill({ status: 404, body: "not found" });
  });
}

test.describe("cockpit · 首页", () => {
  test("HUD + KPI + 2-col flight + DrawerRail render", async ({ page }) => {
    await stubBackend(page, baseSummary());
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "驾驶舱" })).toBeVisible();

    // HUD present: live/refresh/pause buttons
    await expect(page.getByTestId("cockpit-hud")).toBeVisible();
    await expect(page.getByTestId("hud-refresh")).toBeVisible();
    await expect(page.getByTestId("hud-pause")).toBeVisible();

    // KPI cells present (testid-scoped to avoid sidebar-link collisions)
    await expect(page.getByTestId("kpi-员工")).toBeVisible();
    await expect(page.getByTestId("kpi-任务")).toBeVisible();
    await expect(page.getByTestId("kpi-进行中 · Run")).toBeVisible();
    await expect(page.getByTestId("kpi-触发器")).toBeVisible();
    await expect(page.getByTestId("kpi-制品")).toBeVisible();
    await expect(page.getByTestId("kpi-Tokens / 24h")).toBeVisible();
    await expect(page.getByTestId("kpi-成本 / 24h")).toBeVisible();

    // 2-col main: activity feed + active runs
    await expect(page.getByText("活动流 · 飞行记录")).toBeVisible();
    await expect(page.getByText("正在执行")).toBeVisible();
    await expect(page.getByText("Lead 开始处理")).toBeVisible();

    // DrawerRail with all 3 drawer buttons + observatory link
    await expect(page.getByTestId("cockpit-drawer-rail")).toBeVisible();
    await expect(page.getByTestId("rail-health")).toBeVisible();
    await expect(page.getByTestId("rail-budget")).toBeVisible();
    await expect(page.getByTestId("rail-convs")).toBeVisible();
    await expect(page.getByTestId("rail-observatory")).toBeVisible();

    // Definition-class affordances are deliberately gone from cockpit.
    await expect(page.getByRole("button", { name: "+ 新员工" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ 新触发器" })).toHaveCount(0);
    await expect(page.getByText("快速操作")).toHaveCount(0);
  });

  test("rail opens Budget drawer, shows token breakdown, ESC closes", async ({
    page,
  }) => {
    await stubBackend(page, baseSummary());
    await page.goto("/");

    await expect(page.getByTestId("cockpit-drawer-budget")).toHaveCount(0);
    await page.getByTestId("rail-budget").click();

    const drawer = page.getByTestId("cockpit-drawer-budget");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("今日消耗")).toBeVisible();
    await expect(drawer.getByText(/\$0\.42/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("cockpit-drawer-budget")).toHaveCount(0);
  });

  test("rail opens Health drawer with per-component rows", async ({ page }) => {
    await stubBackend(
      page,
      baseSummary({
        health: {
          gateway: { name: "gateway", status: "ok", detail: "2 providers" },
          mcp_servers: { name: "mcp", status: "degraded", detail: "slow" },
          langfuse: { name: "langfuse", status: "ok", detail: null },
          db: { name: "db", status: "ok", detail: null },
          triggers: { name: "triggers", status: "ok", detail: null },
        },
      }),
    );
    await page.goto("/");

    await page.getByTestId("rail-health").click();
    const drawer = page.getByTestId("cockpit-drawer-health");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("模型网关")).toBeVisible();
    await expect(drawer.getByText("MCP 服务器")).toBeVisible();
    await expect(drawer.getByText("DEGRADED")).toBeVisible();
  });

  test("HUD 急停 → ConfirmDialog → paused HUD → resume", async ({ page }) => {
    let paused = false;

    await page.route("**/api/cockpit/summary", async (route) => {
      await route.fulfill({
        json: baseSummary({
          paused,
          paused_reason: paused ? "Cockpit 急停" : null,
          paused_at: paused ? new Date().toISOString() : null,
        }),
      });
    });
    await page.route("**/api/cockpit/stream", async (route) => {
      await route.fulfill({ status: 404, body: "not found" });
    });
    await page.route("**/api/cockpit/pause-all", async (route) => {
      paused = true;
      await route.fulfill({
        json: {
          paused: true,
          reason: "Cockpit 急停",
          paused_at: new Date().toISOString(),
          already_paused: false,
        },
      });
    });
    await page.route("**/api/cockpit/resume-all", async (route) => {
      paused = false;
      await route.fulfill({
        json: { paused: false, reason: null, paused_at: null, already_paused: false },
      });
    });

    await page.goto("/");

    // Click 急停 on HUD, ConfirmDialog appears, ESC dismisses it.
    await page.getByTestId("hud-pause").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/急停所有 run/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // Click 急停 again, confirm, HUD flips to 已暂停 + resume affordance.
    await page.getByTestId("hud-pause").click();
    await dialog.getByRole("button", { name: "确认急停" }).click();

    await expect(page.getByText("已暂停")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("hud-resume")).toBeVisible();

    // Resume from HUD.
    await page.getByTestId("hud-resume").click();
    await expect(page.getByTestId("hud-pause")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("已暂停")).toHaveCount(0);
  });
});
