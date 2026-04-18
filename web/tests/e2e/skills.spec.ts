import { test, expect } from "@playwright/test";

/**
 * /skills 主路径 smoke:
 * - 已安装空态、市场列表、市场安装 → 回到已安装
 * - 卸载走 ConfirmDialog(不是 window.confirm),Escape 可取消
 * - 错误状态 shows retry
 */

const MARKET = [
  {
    slug: "mcp-builder",
    name: "mcp-builder",
    description: "构建 MCP 服务器的脚手架技能",
    source_url: "https://github.com/anthropics/mcp-builder",
    version: "0.1.0",
    tags: ["scaffold", "mcp"],
  },
  {
    slug: "claude-api",
    name: "claude-api",
    description: "Claude API usage helpers",
    source_url: "https://github.com/anthropics/claude-api",
    version: "0.2.0",
    tags: ["api"],
  },
];

const SKILL_MD = `---
name: mcp-builder
description: 构建 MCP 服务器的脚手架技能
version: 0.1.0
---

# mcp-builder

body preview
`;

test.describe("skills · 三态 + 市场 install + ConfirmDialog 卸载", () => {
  test("empty → install from market → uninstall via ConfirmDialog", async ({
    page,
  }) => {
    let skills: Array<Record<string, unknown>> = [];

    await page.route("**/api/skills", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: skills });
      } else {
        await route.continue();
      }
    });

    // Match both `/api/skills/market` and `/api/skills/market?q=...`
    await page.route(/\/api\/skills\/market(\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const filtered = q
        ? MARKET.filter(
            (e) =>
              e.slug.includes(q) ||
              e.name.includes(q) ||
              e.description.toLowerCase().includes(q) ||
              e.tags.some((t) => t.includes(q)),
          )
        : MARKET;
      await route.fulfill({ json: filtered });
    });

    await page.route("**/api/skills/install/market", async (route) => {
      const body = route.request().postDataJSON() as { slug: string };
      const created = {
        id: "skill-1",
        name: body.slug,
        description: "fixture",
        tool_ids: [],
        prompt_fragment: null,
        version: "0.1.0",
        source: "market",
        source_url: `https://github.com/anthropics/${body.slug}`,
        installed_at: "2026-04-18T00:00:00Z",
        path: `/tmp/skills/${body.slug}`,
      };
      skills = [created];
      await route.fulfill({ json: created, status: 201 });
    });

    await page.route("**/api/skills/*", async (route) => {
      if (route.request().method() === "DELETE") {
        skills = [];
        await route.fulfill({ status: 204, body: "" });
      } else {
        await route.continue();
      }
    });

    await page.goto("/skills");

    // 默认"已安装" tab,空态
    await expect(page.getByTestId("skills-empty")).toBeVisible();

    // 切到市场
    await page.getByTestId("tab-market").click();
    await expect(page.getByTestId("market-mcp-builder")).toBeVisible();

    // 安装 → 自动跳回"已安装"
    await page.getByTestId("install-mcp-builder").click();
    await expect(page.getByTestId("skill-mcp-builder")).toBeVisible();

    // 卸载按钮打开 ConfirmDialog
    await page.getByTestId("delete-mcp-builder").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/卸载技能/)).toBeVisible();

    // Escape 关闭 —— P07 键盘可达
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // 再开,确认卸载
    await page.getByTestId("delete-mcp-builder").click();
    await dialog.getByRole("button", { name: "卸载" }).click();
    await expect(page.getByTestId("skills-empty")).toBeVisible();
  });

  test("error state shows retry", async ({ page }) => {
    let failFirst = true;
    await page.route("**/api/skills", async (route) => {
      if (failFirst) {
        failFirst = false;
        await route.fulfill({ status: 500, body: "boom" });
      } else {
        await route.fulfill({ json: [] });
      }
    });
    await page.route(/\/api\/skills\/market(\?.*)?$/, async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto("/skills");
    await expect(page.getByTestId("skills-error")).toBeVisible();
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByTestId("skills-empty")).toBeVisible();
  });

  test("market search filters entries by query", async ({ page }) => {
    await page.route("**/api/skills", async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route(/\/api\/skills\/market(\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const filtered = q
        ? MARKET.filter(
            (e) =>
              e.slug.includes(q) ||
              e.description.toLowerCase().includes(q) ||
              e.tags.some((t) => t.includes(q)),
          )
        : MARKET;
      await route.fulfill({ json: filtered });
    });

    await page.goto("/skills");
    await page.getByTestId("tab-market").click();
    await expect(page.getByTestId("market-mcp-builder")).toBeVisible();
    await expect(page.getByTestId("market-claude-api")).toBeVisible();

    // Search narrows to the matching slug (debounced 300ms)
    await page.getByTestId("market-search").fill("claude");
    await expect(page.getByTestId("market-claude-api")).toBeVisible();
    await expect(page.getByTestId("market-mcp-builder")).not.toBeVisible();

    // Tag match still works
    await page.getByTestId("market-search").fill("scaffold");
    await expect(page.getByTestId("market-mcp-builder")).toBeVisible();
    await expect(page.getByTestId("market-claude-api")).not.toBeVisible();

    // Empty query restores full list
    await page.getByTestId("market-search").fill("");
    await expect(page.getByTestId("market-mcp-builder")).toBeVisible();
    await expect(page.getByTestId("market-claude-api")).toBeVisible();
  });

  test("preview modal shows SKILL.md and installs from modal", async ({ page }) => {
    let skills: Array<Record<string, unknown>> = [];
    await page.route("**/api/skills", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: skills });
      } else {
        await route.continue();
      }
    });
    await page.route(/\/api\/skills\/market(\?.*)?$/, async (route) => {
      await route.fulfill({ json: MARKET });
    });
    await page.route("**/api/skills/market/mcp-builder/preview", async (route) => {
      await route.fulfill({
        json: {
          slug: "mcp-builder",
          name: "mcp-builder",
          description: "构建 MCP 服务器的脚手架技能",
          version: "0.1.0",
          source_url: "https://github.com/anthropics/skills/tree/main/skills/mcp-builder",
          skill_md: SKILL_MD,
          files: ["SKILL.md", "README.md"],
        },
      });
    });
    await page.route("**/api/skills/install/market", async (route) => {
      const body = route.request().postDataJSON() as { slug: string };
      skills = [
        {
          id: "skill-1",
          name: body.slug,
          description: "fixture",
          tool_ids: [],
          prompt_fragment: null,
          version: "0.1.0",
          source: "market",
          source_url: `https://github.com/anthropics/${body.slug}`,
          installed_at: "2026-04-18T00:00:00Z",
          path: `/tmp/skills/${body.slug}`,
        },
      ];
      await route.fulfill({ json: skills[0], status: 201 });
    });

    await page.goto("/skills");
    await page.getByTestId("tab-market").click();

    // Open preview
    await page.getByTestId("preview-mcp-builder").click();
    const modal = page.getByTestId("preview-modal");
    await expect(modal).toBeVisible();
    await expect(page.getByTestId("preview-skill-md")).toContainText("name: mcp-builder");
    await expect(modal).toContainText("SKILL.md");
    await expect(modal).toContainText("README.md");

    // Escape closes — P07 键盘可达
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();

    // Reopen and install from modal → back on installed tab
    await page.getByTestId("preview-mcp-builder").click();
    await expect(modal).toBeVisible();
    await page.getByTestId("preview-install").click();
    await expect(page.getByTestId("skill-mcp-builder")).toBeVisible();
  });
});
