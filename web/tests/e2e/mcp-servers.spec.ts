import { test, expect } from "@playwright/test";

/**
 * /mcp-servers 主路径 smoke:
 * - 空态 / 添加 stdio → 已注册 / 测试连接 / 列工具 / 删除
 * - ConfirmDialog(不是 window.confirm),Escape 可取消(P07)
 * - 错误状态 shows retry
 */

test.describe("mcp-servers · 三态 + add + test + tools + ConfirmDialog delete", () => {
  test("empty → add stdio → test → list tools → delete via ConfirmDialog", async ({
    page,
  }) => {
    let servers: Array<Record<string, unknown>> = [];

    await page.route("**/api/mcp-servers", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({ json: servers });
        return;
      }
      if (method === "POST") {
        const body = route.request().postDataJSON() as {
          name: string;
          transport: string;
          config: Record<string, unknown>;
        };
        const created = {
          id: "srv-1",
          name: body.name,
          transport: body.transport,
          config: body.config,
          enabled: true,
          exposed_tool_ids: [],
          last_handshake_at: null,
          health: "unknown",
        };
        servers = [created];
        await route.fulfill({ json: created, status: 201 });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/mcp-servers/srv-1/test", async (route) => {
      const updated = {
        ...(servers[0] as Record<string, unknown>),
        health: "ok",
        last_handshake_at: "2026-04-18T00:00:00Z",
      };
      servers = [updated];
      await route.fulfill({ json: updated });
    });

    await page.route("**/api/mcp-servers/srv-1/tools", async (route) => {
      await route.fulfill({
        json: [
          { name: "echo", description: "echo back", input_schema: { type: "object" } },
        ],
      });
    });

    await page.route("**/api/mcp-servers/srv-1", async (route) => {
      if (route.request().method() === "DELETE") {
        servers = [];
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      await route.continue();
    });

    await page.goto("/mcp-servers");

    await expect(page.getByTestId("mcp-empty")).toBeVisible();

    // 切到添加,填 stdio form
    await page.getByTestId("tab-add").click();
    await page.getByPlaceholder("例如 github-official").fill("echo-server");
    await page.getByTestId("field-command").fill("echo");
    await page.getByTestId("add-submit").click();

    // 回到已注册,看到新卡片
    await expect(page.getByTestId("mcp-echo-server")).toBeVisible();
    await expect(page.getByTestId("health-echo-server")).toBeVisible();

    // 测试连接 → health 变 ok
    await page.getByTestId("test-echo-server").click();
    await expect(page.getByTestId("health-echo-server")).toHaveAttribute(
      "aria-label",
      "health ok",
    );

    // 展开工具
    await page.getByTestId("tools-echo-server").click();
    await expect(page.getByTestId("tool-echo-server-echo")).toBeVisible();

    // 删除按钮打开 ConfirmDialog
    await page.getByTestId("delete-echo-server").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/删除 MCP 服务器/)).toBeVisible();

    // Escape 关闭 —— P07
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // 再开,确认删除
    await page.getByTestId("delete-echo-server").click();
    await dialog.getByRole("button", { name: "删除" }).click();
    await expect(page.getByTestId("mcp-empty")).toBeVisible();
  });

  test("error state shows retry", async ({ page }) => {
    let failFirst = true;
    await page.route("**/api/mcp-servers", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      if (failFirst) {
        failFirst = false;
        await route.fulfill({ status: 500, body: "boom" });
      } else {
        await route.fulfill({ json: [] });
      }
    });

    await page.goto("/mcp-servers");
    await expect(page.getByTestId("mcp-error")).toBeVisible();
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByTestId("mcp-empty")).toBeVisible();
  });
});
