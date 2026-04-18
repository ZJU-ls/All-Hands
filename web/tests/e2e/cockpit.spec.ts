import { test, expect } from "@playwright/test";

/**
 * Cockpit / 主路径 smoke(KPI + 三列 + 急停确认)。
 *
 * 后端 mock:拦截 `/api/cockpit/summary` 与 `/api/cockpit/pause-all|resume-all`。
 * 覆盖:
 *   - 首次加载显示 KPI / 活动流 / 进行中 / 最近对话 / 健康 / 快速操作 / 今日消耗
 *   - 急停按钮 → ConfirmDialog → 确认后调 /pause-all → 展示"全局已暂停"
 *   - Escape 关闭确认框(P07 键盘可达)
 */

type Summary = {
  employees_total: number;
  runs_active: number;
  conversations_today: number;
  artifacts_total: number;
  artifacts_this_week_delta: number;
  triggers_active: number;
  tokens_today_total: number;
  tokens_today_prompt: number;
  tokens_today_completion: number;
  estimated_cost_today_usd: number;
  health: Record<string, { status: string; detail: string | null }>;
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
    tokens_today_total: 12_345,
    tokens_today_prompt: 8_000,
    tokens_today_completion: 4_345,
    estimated_cost_today_usd: 0.42,
    health: {
      gateway: { status: "ok", detail: "2 providers" },
      mcp_servers: { status: "ok", detail: "3 servers" },
      langfuse: { status: "ok", detail: null },
      db: { status: "ok", detail: "reachable" },
      triggers: { status: "ok", detail: "2 active" },
    },
    confirmations_pending: 0,
    runs_failing_recently: 0,
    recent_events: [
      {
        id: "e1",
        ts: new Date().toISOString(),
        severity: "info",
        kind: "run_started",
        title: "Lead 开始处理",
        detail: null,
        ref_id: null,
      },
    ],
    active_runs: [],
    recent_conversations: [
      {
        id: "c1",
        title: "设计今日团队",
        employee_name: "Lead",
        updated_at: new Date().toISOString(),
      },
    ],
    paused: false,
    paused_reason: null,
    paused_at: null,
    ...overrides,
  };
}

test.describe("cockpit · 首页", () => {
  test("渲染 KPI / 三列 / 活动流", async ({ page }) => {
    await page.route("**/api/cockpit/summary", async (route) => {
      await route.fulfill({ json: baseSummary() });
    });

    await page.goto("/");

    await expect(page.getByText("驾驶舱")).toBeVisible();
    await expect(page.getByText("员工")).toBeVisible();
    await expect(page.getByText("进行中")).toBeVisible();
    await expect(page.getByText("触发器")).toBeVisible();
    await expect(page.getByText("制品")).toBeVisible();
    await expect(page.getByText("Tokens")).toBeVisible();
    await expect(page.getByText("估算成本")).toBeVisible();
    await expect(page.getByText("最近活动")).toBeVisible();
    await expect(page.getByText("进行中的 run")).toBeVisible();
    await expect(page.getByText("最近对话")).toBeVisible();
    await expect(page.getByText("健康")).toBeVisible();
    await expect(page.getByText("快速操作")).toBeVisible();
    await expect(page.getByText("今日消耗")).toBeVisible();
  });

  test("急停 → ConfirmDialog → 暂停条 → 恢复", async ({ page }) => {
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
    await page.route("**/api/cockpit/pause-all", async (route) => {
      paused = true;
      await route.fulfill({
        json: { paused: true, reason: "Cockpit 急停", paused_at: new Date().toISOString(), already_paused: false },
      });
    });
    await page.route("**/api/cockpit/resume-all", async (route) => {
      paused = false;
      await route.fulfill({
        json: { paused: false, reason: null, paused_at: null, already_paused: false },
      });
    });

    await page.goto("/");

    await page.getByRole("button", { name: "急停所有 run" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/急停所有 run/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    await page.getByRole("button", { name: "急停所有 run" }).click();
    await dialog.getByRole("button", { name: "确认急停" }).click();

    await expect(page.getByText(/全局已暂停/)).toBeVisible();

    await page
      .locator('div:has-text("全局已暂停")')
      .getByRole("button", { name: "恢复运行" })
      .first()
      .click();
    await expect(page.getByText(/全局已暂停/)).not.toBeVisible({ timeout: 10_000 });
  });
});
