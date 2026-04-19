import { test, expect } from "@playwright/test";

/**
 * /employees/design · Track L (I-0021) Phase 3B e2e.
 *
 * Phase 2 shipped the skeleton (skill/mcp mount + disabled preset). Phase 3B
 * enables the preset region per SIGNOFF-agent-runtime-contract.md Q6-Q10:
 *
 *  - 3 presets radio group with friendly Chinese labels
 *    (标准执行 / 先出计划 / 计划+派子代理)
 *  - Default selection = `execute`
 *  - Switching preset pre-populates tool + skill pickers + max_iterations
 *  - Dry run panel calls `preview_employee_composition` meta tool
 *  - `plan_with_subagent` max_iterations = 15 (SIGNOFF Q7, NOT the contract's 20)
 *  - Submit → POST /api/employees with the expanded tool_ids/skill_ids/max_iterations
 *  - §3.2 red line: `mode` never appears in the submitted body or the page source
 */

type Json = Record<string, unknown>;

const SKILLS = [
  { id: "sk_research", name: "research", description: "Web research" },
  { id: "sk_write", name: "write", description: "Write files" },
  { id: "sk_planner", name: "planner", description: "Structured plan first" },
  {
    id: "sk_executor_spawn",
    name: "executor_spawn",
    description: "Spawn subagent",
  },
].map((s) => ({
  ...s,
  tool_ids: [],
  prompt_fragment: null,
  version: "1.0",
  source: "builtin",
  source_url: null,
  installed_at: null,
  path: null,
}));

const MCP_SERVERS = [
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

function presetExpansion(
  preset: string,
  overrides?: {
    custom_tool_ids?: string[];
    custom_skill_ids?: string[];
    custom_max_iterations?: number;
  },
): Json {
  const base: Record<string, Json> = {
    execute: {
      tool_ids: [
        "allhands.builtin.fetch_url",
        "allhands.builtin.write_file",
        "allhands.meta.resolve_skill",
      ],
      skill_ids: ["sk_research", "sk_write"],
      max_iterations: 10,
    },
    plan: {
      tool_ids: ["allhands.builtin.render_plan", "allhands.meta.resolve_skill"],
      skill_ids: ["sk_planner"],
      max_iterations: 3,
    },
    plan_with_subagent: {
      tool_ids: [
        "allhands.builtin.render_plan",
        "allhands.meta.spawn_subagent",
        "allhands.meta.resolve_skill",
      ],
      skill_ids: ["sk_planner", "sk_executor_spawn"],
      max_iterations: 15,
    },
  };
  const def = base[preset];
  if (!def) throw new Error(`unknown preset ${preset}`);
  const dedupe = (xs: string[]) => Array.from(new Set(xs));
  const tool_ids = dedupe([
    ...(def.tool_ids as string[]),
    ...(overrides?.custom_tool_ids ?? []),
  ]);
  const skill_ids =
    overrides?.custom_skill_ids !== undefined
      ? dedupe(overrides.custom_skill_ids)
      : (def.skill_ids as string[]);
  const max_iterations =
    overrides?.custom_max_iterations ?? (def.max_iterations as number);
  return { tool_ids, skill_ids, max_iterations };
}

function installRoutes(
  page: import("@playwright/test").Page,
  state: {
    employees: Json[];
    lastPost?: Json;
  },
) {
  page.route("**/api/employees/preview", async (route) => {
    const body = route.request().postDataJSON() as Json;
    try {
      const out = presetExpansion(body.preset as string, {
        custom_tool_ids: body.custom_tool_ids as string[] | undefined,
        custom_skill_ids: body.custom_skill_ids as string[] | undefined,
        custom_max_iterations: body.custom_max_iterations as number | undefined,
      });
      await route.fulfill({ json: out });
    } catch {
      await route.fulfill({ status: 422, json: { detail: "unknown preset" } });
    }
  });
  page.route("**/api/employees", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({ json: state.employees });
      return;
    }
    if (method === "POST") {
      const body = route.request().postDataJSON() as Json;
      state.lastPost = body;
      // §3.2 red line: the submitted body must never contain `mode`.
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
      state.employees.push(created);
      await route.fulfill({ status: 201, json: created });
      return;
    }
    await route.continue();
  });
  page.route("**/api/skills", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: SKILLS });
      return;
    }
    await route.continue();
  });
  page.route("**/api/mcp-servers", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: MCP_SERVERS });
      return;
    }
    await route.continue();
  });
}

test.describe("/employees/design · Phase 3B preset + dry run", () => {
  test("preset radio: 3 options with Chinese labels, default = execute", async ({
    page,
  }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/design");

    // 3 radios present, enabled, with friendly Chinese labels visible.
    await expect(page.getByTestId("preset-execute")).toBeEnabled();
    await expect(page.getByTestId("preset-plan")).toBeEnabled();
    await expect(page.getByTestId("preset-plan_with_subagent")).toBeEnabled();
    await expect(page.getByText("标准执行")).toBeVisible();
    await expect(page.getByText("先出计划")).toBeVisible();
    await expect(page.getByText("计划+派子代理")).toBeVisible();

    // Default = execute.
    await expect(page.getByTestId("preset-execute")).toBeChecked();
    // And the old "locked" notice is gone.
    await expect(page.getByTestId("preset-locked-notice")).toHaveCount(0);
  });

  test("plan preset: sk_planner pre-checked, max_iterations=3", async ({
    page,
  }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/design");
    await page.getByTestId("preset-plan").check();

    // Skill whitelist pre-checks sk_planner.
    await expect(page.getByTestId("skill-sk_planner-checked")).toBeVisible();
    // max_iterations slider/input shows preset default (3).
    await expect(page.getByTestId("field-max-iterations")).toHaveValue("3");
  });

  test("plan_with_subagent: max_iterations = 15 (SIGNOFF Q7, not 20)", async ({
    page,
  }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/design");
    await page.getByTestId("preset-plan_with_subagent").check();

    // The SIGNOFF Q7 answer lowered max_iterations from the contract's 20 to 15.
    await expect(page.getByTestId("field-max-iterations")).toHaveValue("15");
  });

  test("dry run panel shows expanded tool_ids + skill_ids + max_iterations", async ({
    page,
  }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/design");
    await page.getByTestId("preset-execute").check();
    await page.getByTestId("dryrun-button").click();

    const panel = page.getByTestId("dryrun-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("allhands.builtin.fetch_url");
    await expect(panel).toContainText("allhands.builtin.write_file");
    await expect(panel).toContainText("allhands.meta.resolve_skill");
    await expect(panel).toContainText("sk_research");
    await expect(panel).toContainText("sk_write");
    await expect(panel).toContainText("10");
  });

  test("submit: posts expanded tool_ids / skill_ids / max_iterations, never `mode`", async ({
    page,
  }) => {
    const state: { employees: Json[]; lastPost?: Json } = { employees: [] };
    installRoutes(page, state);
    await page.goto("/employees/design");

    await page.getByTestId("field-name").fill("researcher-a");
    await page.getByTestId("preset-execute").check();
    await page.getByTestId("design-save").click();

    await expect(page.getByTestId("design-emp-new")).toBeVisible();

    // The body POSTed by the form must carry the preset-expanded arrays.
    expect(state.lastPost).toBeTruthy();
    const posted = state.lastPost as Json;
    expect(Object.keys(posted)).not.toContain("mode");
    expect(posted.tool_ids).toEqual(
      expect.arrayContaining([
        "allhands.builtin.fetch_url",
        "allhands.builtin.write_file",
        "allhands.meta.resolve_skill",
      ]),
    );
    expect(posted.skill_ids).toEqual(
      expect.arrayContaining(["sk_research", "sk_write"]),
    );
    expect(posted.max_iterations).toBe(10);
  });

  test("page source never mentions `mode`", async ({ page }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/design");
    const html = await page.content();
    // §3.2 red-line grep. The page must not render `mode=` as an attribute
    // nor surface `mode:` in quoted string content.
    expect(html).not.toContain("mode=");
    expect(html).not.toMatch(/\bmode\b\s*:\s*['"]/);
  });
});
