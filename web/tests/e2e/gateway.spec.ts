import { test, expect } from "@playwright/test";

/**
 * Gateway accordion smoke (I-0019).
 *
 * Covers:
 *   - Loading → error(retry)→ empty state
 *   - Add first provider from empty state
 *   - Provider accordion toggle + per-model ping state machine
 *   - ConfirmDialog on delete provider (P07 keyboard: Escape dismiss)
 *
 * Backend is mocked via `page.route` so the test doesn't depend on real
 * DB or network.
 */

type Provider = {
  id: string;
  name: string;
  base_url: string;
  api_key_set: boolean;
  default_model: string;
  is_default: boolean;
  enabled: boolean;
};

type Model = {
  id: string;
  provider_id: string;
  name: string;
  display_name: string;
  context_window: number;
  enabled: boolean;
};

test.describe("gateway · accordion 三态 + ConfirmDialog + ping", () => {
  test("empty → add first provider → confirm delete", async ({ page }) => {
    let providers: Provider[] = [];
    const models: Model[] = [];

    await page.route("**/api/providers", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: providers });
        return;
      }
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        providers = [
          {
            id: "prov-1",
            name: String(body.name ?? ""),
            base_url: String(body.base_url ?? ""),
            api_key_set: true,
            default_model: String(body.default_model ?? ""),
            is_default: body.set_as_default === true,
            enabled: true,
          },
        ];
        await route.fulfill({ json: providers[0], status: 201 });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/models", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: models });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/providers/*", async (route) => {
      if (route.request().method() === "DELETE") {
        providers = [];
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      await route.continue();
    });

    await page.goto("/gateway");
    await expect(page.getByTestId("gateway-empty")).toBeVisible();
    await expect(page.getByText("添加第一个供应商 →")).toBeVisible();

    await page.getByText("添加第一个供应商 →").click();
    await page.getByPlaceholder("例: OpenAI / DeepSeek / 本地 Ollama").fill("OpenAI");
    await page.getByPlaceholder("sk-... (本地部署可留空)").fill("sk-test");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByTestId("gateway-provider-OpenAI")).toBeVisible();

    // Delete via ConfirmDialog (not window.confirm)
    await page
      .getByTestId("gateway-provider-OpenAI")
      .getByRole("button", { name: "删除" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // P07 · Escape dismisses
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // Re-open and confirm
    await page
      .getByTestId("gateway-provider-OpenAI")
      .getByRole("button", { name: "删除" })
      .click();
    await dialog.getByRole("button", { name: "删除" }).click();
    await expect(page.getByTestId("gateway-empty")).toBeVisible();
  });

  test("error state → retry", async ({ page }) => {
    let failNext = true;
    await page.route("**/api/providers", async (route) => {
      if (failNext) {
        failNext = false;
        await route.fulfill({ status: 500, body: "boom" });
      } else {
        await route.fulfill({ json: [] });
      }
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto("/gateway");
    await expect(page.getByTestId("gateway-error")).toBeVisible();
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByTestId("gateway-empty")).toBeVisible();
  });

  test("accordion ping ok + fail transitions", async ({ page }) => {
    const providers: Provider[] = [
      {
        id: "p1",
        name: "DemoCo",
        base_url: "https://demo.example.com/v1",
        api_key_set: true,
        default_model: "m-ok",
        is_default: true,
        enabled: true,
      },
    ];
    const models: Model[] = [
      {
        id: "m-ok",
        provider_id: "p1",
        name: "fast-model",
        display_name: "Fast",
        context_window: 32_000,
        enabled: true,
      },
      {
        id: "m-fail",
        provider_id: "p1",
        name: "broken-model",
        display_name: "Broken",
        context_window: 4096,
        enabled: true,
      },
    ];

    await page.route("**/api/providers", async (route) => {
      await route.fulfill({ json: providers });
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({ json: models });
    });
    await page.route("**/api/models/m-ok/ping", async (route) => {
      await route.fulfill({
        json: { ok: true, latency_ms: 123, response: "ok" },
      });
    });
    await page.route("**/api/models/m-fail/ping", async (route) => {
      await route.fulfill({
        json: {
          ok: false,
          error: "401 unauthorized",
          error_category: "auth",
          latency_ms: 47,
        },
      });
    });

    await page.goto("/gateway");
    await expect(page.getByTestId("gateway-provider-DemoCo")).toBeVisible();
    await expect(page.getByTestId("gateway-model-fast-model")).toBeVisible();

    // Trigger single-model ping · ok
    await page.getByTestId("gateway-ping-m-ok").click();
    const okResult = page.getByTestId("gateway-ping-result-m-ok");
    await expect(okResult.locator('[data-ping-state="ok"]')).toBeVisible();
    await expect(okResult).toContainText("123ms");

    // Trigger single-model ping · fail → shows category label
    await page.getByTestId("gateway-ping-m-fail").click();
    const failResult = page.getByTestId("gateway-ping-result-m-fail");
    await expect(failResult.locator('[data-ping-state="fail"]')).toBeVisible();
    await expect(failResult).toContainText("认证失败");
  });
});
