import { test, expect } from "@playwright/test";

/**
 * Gateway 主路径 smoke(provider / model 页的三态 + ConfirmDialog)。
 *
 * 后端 mock:page.route 拦截 `/api/providers*` 和 `/api/models*`,
 * 让测试不依赖真实 backend / DB,只验证 UI 契约。
 */

test.describe("gateway · 三态 + ConfirmDialog", () => {
  test("providers empty → add first → confirm delete", async ({ page }) => {
    let providers: Array<Record<string, unknown>> = [];

    await page.route("**/api/providers", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: providers });
      } else if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        providers = [
          {
            id: "prov-1",
            name: body.name,
            base_url: body.base_url,
            api_key_set: true,
            default_model: body.default_model,
            is_default: body.set_as_default === true,
            enabled: true,
          },
        ];
        await route.fulfill({ json: providers[0], status: 201 });
      }
    });

    await page.route("**/api/providers/*", async (route) => {
      if (route.request().method() === "DELETE") {
        providers = [];
        await route.fulfill({ status: 204, body: "" });
      } else {
        await route.continue();
      }
    });

    await page.goto("/gateway/providers");
    await expect(page.getByTestId("providers-empty")).toBeVisible();
    await expect(page.getByText("添加第一个供应商 →")).toBeVisible();

    await page.getByText("添加第一个供应商 →").click();
    await page.getByPlaceholder("例: OpenAI / DeepSeek / 本地 Ollama").fill("OpenAI");
    await page.getByPlaceholder("sk-... (本地部署可留空)").fill("sk-test");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByText("OpenAI")).toBeVisible();

    // 删除按钮触发 ConfirmDialog(不是 window.confirm)
    await page.getByRole("button", { name: "删除" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/删除供应商/)).toBeVisible();

    // Escape 关闭 —— P07 键盘可达
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // 再开,确认删除
    await page.getByRole("button", { name: "删除" }).click();
    await dialog.getByRole("button", { name: "删除" }).click();
    await expect(page.getByTestId("providers-empty")).toBeVisible();
  });

  test("providers error state shows retry", async ({ page }) => {
    let failFirst = true;
    await page.route("**/api/providers", async (route) => {
      if (failFirst) {
        failFirst = false;
        await route.fulfill({ status: 500, body: "boom" });
      } else {
        await route.fulfill({ json: [] });
      }
    });

    await page.goto("/gateway/providers");
    await expect(page.getByTestId("providers-error")).toBeVisible();
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByTestId("providers-empty")).toBeVisible();
  });

  test("models needs-provider banner links to /gateway/providers", async ({ page }) => {
    await page.route("**/api/providers", async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto("/gateway/models");
    await expect(page.getByTestId("models-needs-provider")).toBeVisible();
    await expect(page.getByRole("link", { name: /前往 供应商/ })).toHaveAttribute(
      "href",
      "/gateway/providers",
    );
  });
});
