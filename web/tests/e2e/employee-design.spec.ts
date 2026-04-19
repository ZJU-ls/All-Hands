import { test, expect } from "@playwright/test";

/**
 * /employees/design · Track L (I-0021) Phase 2 骨架 smoke。
 *
 * 覆盖:
 * - 左列员工列表(含新建态)· 右栏基础信息 + SkillMultiPicker + McpMultiPicker
 * - PresetRadio 占位 · disabled + "等 Track M 契约"(Phase 3B 才启用)
 * - 保存按钮调 POST /api/employees(方案 A · L01 对偶)
 * - 红线:表单 state 不得出现 `mode` 字段(字段反向断言见 vitest 单元测试)
 */

test.describe("/employees/design · 员工设计页骨架", () => {
  test("load → fill basic info → pick skill + mcp → save → POST /api/employees", async ({
    page,
  }) => {
    let employees: Array<Record<string, unknown>> = [
      {
        id: "lead",
        name: "lead",
        description: "Lead agent",
        system_prompt: "",
        is_lead_agent: true,
        tool_ids: ["allhands.meta.create_employee"],
        skill_ids: [],
        max_iterations: 20,
        model_ref: "openai/gpt-4o-mini",
      },
    ];

    const skills = [
      {
        id: "sk_research",
        name: "research",
        description: "Web research",
        tool_ids: ["allhands.builtin.fetch_url"],
        prompt_fragment: null,
        version: "1.0",
        source: "builtin",
        source_url: null,
        installed_at: null,
        path: null,
      },
      {
        id: "sk_write",
        name: "write",
        description: "Write files",
        tool_ids: ["allhands.builtin.write_file"],
        prompt_fragment: null,
        version: "1.0",
        source: "builtin",
        source_url: null,
        installed_at: null,
        path: null,
      },
    ];

    const mcpServers = [
      {
        id: "srv-github",
        name: "github-official",
        transport: "stdio",
        config: {},
        enabled: true,
        exposed_tool_ids: [],
        last_handshake_at: null,
        health: "unknown",
      },
    ];

    await page.route("**/api/employees", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({ json: employees });
        return;
      }
      if (method === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        // 红线断言:不得包含 mode
        expect(Object.keys(body)).not.toContain("mode");
        const created = {
          id: "new",
          name: body.name,
          description: body.description ?? "",
          system_prompt: body.system_prompt ?? "",
          is_lead_agent: false,
          tool_ids: body.tool_ids ?? [],
          skill_ids: body.skill_ids ?? [],
          max_iterations: body.max_iterations ?? 10,
          model_ref: body.model_ref ?? "openai/gpt-4o-mini",
        };
        employees = [...employees, created];
        await route.fulfill({ status: 201, json: created });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/skills", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: skills });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/mcp-servers", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: mcpServers });
        return;
      }
      await route.continue();
    });

    await page.goto("/employees/design");

    // 左列:能看到现有 lead + 新建按钮
    await expect(page.getByTestId("design-employee-list")).toBeVisible();
    await expect(page.getByTestId("design-emp-lead")).toBeVisible();
    await expect(page.getByTestId("design-new-employee")).toBeVisible();

    // 基础信息必填
    await page.getByTestId("field-name").fill("researcher-a");
    await page.getByTestId("field-description").fill("Web research employee");

    // 运转方式(preset)· Phase 3B 前三个都 disabled
    const presetExecute = page.getByTestId("preset-execute");
    await expect(presetExecute).toBeDisabled();
    await expect(page.getByTestId("preset-locked-notice")).toBeVisible();

    // 挂载技能
    await page.getByTestId("skill-sk_research").click();

    // 挂载 MCP
    await page.getByTestId("mcp-srv-github").click();

    // 系统 prompt
    await page.getByTestId("field-system-prompt").fill("You are a thorough researcher.");

    // 保存 → POST
    await page.getByTestId("design-save").click();

    // 新员工出现在左列
    await expect(page.getByTestId("design-emp-new")).toBeVisible();
    await expect(page.getByTestId("design-emp-new")).toHaveText(/researcher-a/);
  });

  test("empty name disables save", async ({ page }) => {
    await page.route("**/api/employees", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: [] });
        return;
      }
      await route.continue();
    });
    await page.route("**/api/skills", async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.route("**/api/mcp-servers", async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto("/employees/design");
    await expect(page.getByTestId("design-save")).toBeDisabled();
  });
});
