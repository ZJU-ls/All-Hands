import { test, expect } from "@playwright/test";

/**
 * Employee designer e2e — Phase 2 split.
 *
 *   /employees/new            · hire surface
 *   /employees/{id}?tab=config · edit / publish / delete
 *
 * Old `/employees/design` route now 302s to /employees, so the spec covers
 * both the new hire flow and the inline-config tab on the detail page.
 *
 * Carried over invariants:
 *   - Preset radio (3 options · default execute · friendly Chinese labels)
 *   - Switching preset pre-populates skills + max_iterations
 *   - plan_with_subagent max_iterations = 15 (SIGNOFF Q7)
 *   - Dry-run panel calls preview_employee_composition
 *   - Submit → POST /api/employees with expanded arrays · §3.2 red line: no
 *     `mode` field anywhere in body or page source
 *   - Lifecycle: publish flips status · delete removes employee
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
  page.route(/\/api\/employees(\?[^/]*)?$/, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      // Backend semantics:
      //   no status filter → exclude archived
      //   status=archived  → only archived
      //   status=draft / published → only that status
      const url = new URL(route.request().url());
      const status = url.searchParams.get("status");
      const filtered = state.employees.filter((e) => {
        const empStatus = (e as { status?: string }).status ?? "published";
        if (status === null) return empStatus !== "archived";
        return empStatus === status;
      });
      await route.fulfill({ json: filtered });
      return;
    }
    if (method === "POST") {
      const body = route.request().postDataJSON() as Json;
      state.lastPost = body;
      // §3.2 red line: the submitted body must never contain `mode`.
      expect(Object.keys(body)).not.toContain("mode");
      const created = {
        id: "emp-new",
        name: body.name,
        description: body.description ?? "",
        system_prompt: body.system_prompt ?? "",
        is_lead_agent: false,
        tool_ids: body.tool_ids ?? [],
        skill_ids: body.skill_ids ?? [],
        max_iterations: body.max_iterations ?? 10,
        model_ref: body.model_ref ?? "openai/gpt-4o-mini",
        status: body.status ?? "draft",
        published_at: body.status === "published" ? "2026-04-20T00:00:00Z" : null,
      };
      state.employees.push(created);
      await route.fulfill({ status: 201, json: created });
      return;
    }
    await route.continue();
  });
  page.route(/\/api\/employees\/[^/]+\/restore$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const url = route.request().url();
    const id = url.split("/").slice(-2)[0];
    const emp = state.employees.find((e) => (e as { id: string }).id === id) as
      | (Json & { status: string; published_at: string | null })
      | undefined;
    if (!emp) {
      await route.fulfill({ status: 404, json: { detail: "missing" } });
      return;
    }
    emp.status = "published";
    emp.published_at = "2026-04-20T00:00:00Z";
    await route.fulfill({ json: emp });
  });
  page.route(/\/api\/employees\/[^/]+\/publish$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const url = route.request().url();
    const id = url.split("/").slice(-2)[0];
    const emp = state.employees.find((e) => (e as { id: string }).id === id) as
      | (Json & { status: string; published_at: string | null })
      | undefined;
    if (!emp) {
      await route.fulfill({ status: 404, json: { detail: "missing" } });
      return;
    }
    emp.status = "published";
    emp.published_at = "2026-04-20T00:00:00Z";
    await route.fulfill({ json: emp });
  });
  page.route(/\/api\/employees\/[^/]+$/, async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    const id = url.split("/").pop()!.split("?")[0];
    const idx = state.employees.findIndex(
      (e) => (e as { id: string }).id === id,
    );
    if (method === "GET") {
      if (idx < 0) {
        await route.fulfill({ status: 404, json: { detail: "missing" } });
        return;
      }
      await route.fulfill({ json: state.employees[idx] });
      return;
    }
    if (method === "PATCH") {
      if (idx < 0) {
        await route.fulfill({ status: 404, json: { detail: "missing" } });
        return;
      }
      const body = route.request().postDataJSON() as Json;
      state.employees[idx] = { ...state.employees[idx], ...body };
      await route.fulfill({ json: state.employees[idx] });
      return;
    }
    if (method === "DELETE") {
      const hard = new URL(route.request().url()).searchParams.get("hard") === "true";
      if (idx >= 0) {
        if (hard) {
          state.employees.splice(idx, 1);
        } else {
          (state.employees[idx] as { status: string }).status = "archived";
        }
      }
      await route.fulfill({ status: 204 });
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
  // Detail page also pulls /api/conversations?employee_id=... — return empty.
  page.route(/\/api\/conversations(\?[^/]*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });
}

test.describe("/employees/new · hire flow", () => {
  test("preset radio: 3 options with Chinese labels, default = execute", async ({
    page,
  }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/new");

    await expect(page.getByTestId("preset-execute")).toBeEnabled();
    await expect(page.getByTestId("preset-plan")).toBeEnabled();
    await expect(page.getByTestId("preset-plan_with_subagent")).toBeEnabled();
    await expect(page.getByText("标准执行")).toBeVisible();
    await expect(page.getByText("先出计划")).toBeVisible();
    await expect(page.getByText("计划+派子代理")).toBeVisible();

    await expect(page.getByTestId("preset-execute")).toBeChecked();
    await expect(page.getByTestId("preset-locked-notice")).toHaveCount(0);
  });

  test("plan preset: sk_planner pre-checked, max_iterations=3", async ({
    page,
  }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/new");
    await page.getByTestId("preset-plan").check();

    await expect(page.getByTestId("skill-sk_planner-checked")).toBeVisible();
    await expect(page.getByTestId("field-max-iterations")).toHaveValue("3");
  });

  test("plan_with_subagent: max_iterations = 15 (SIGNOFF Q7, not 20)", async ({
    page,
  }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/new");
    await page.getByTestId("preset-plan_with_subagent").check();

    await expect(page.getByTestId("field-max-iterations")).toHaveValue("15");
  });

  test("dry run panel shows expanded tool_ids + skill_ids + max_iterations", async ({
    page,
  }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/new");
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

  test("submit: posts expanded arrays · navigates to detail page config tab · §3.2 no mode", async ({
    page,
  }) => {
    const state: { employees: Json[]; lastPost?: Json } = { employees: [] };
    installRoutes(page, state);
    await page.goto("/employees/new");

    await page.getByTestId("field-name").fill("researcher-a");
    await page.getByTestId("preset-execute").check();
    await page.getByTestId("design-save").click();

    // After save the new page redirects to /employees/{id}?tab=config.
    await page.waitForURL(/\/employees\/emp-new\?tab=config/);
    await expect(page.getByTestId("employee-tab-config")).toBeVisible();

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
    await page.goto("/employees/new");
    const html = await page.content();
    expect(html).not.toContain("mode=");
    expect(html).not.toMatch(/\bmode\b\s*:\s*['"]/);
  });

  test("legacy /employees/design redirects to roster", async ({ page }) => {
    installRoutes(page, { employees: [] });
    await page.goto("/employees/design");
    await page.waitForURL(/\/employees(\?.*)?$/);
  });
});

test.describe("/employees/{id}?tab=config · lifecycle (publish + delete + try)", () => {
  const draftEmp = {
    id: "emp-draft-1",
    name: "drafty",
    description: "a draft",
    system_prompt: "",
    is_lead_agent: false,
    tool_ids: ["allhands.builtin.fetch_url"],
    skill_ids: [],
    max_iterations: 10,
    model_ref: "openai/gpt-4o-mini",
    status: "draft",
    published_at: null,
  } satisfies Json;

  test("draft hero shows draft chip; config tab exposes publish + delete", async ({
    page,
  }) => {
    installRoutes(page, { employees: [{ ...draftEmp }] });
    await page.goto(`/employees/${draftEmp.id}?tab=config`);

    await expect(page.getByTestId("employee-hero-status-draft")).toBeVisible();
    await expect(page.getByTestId("employee-config-publish")).toBeVisible();
    await expect(page.getByTestId("employee-config-delete")).toBeVisible();
  });

  test("publish flips status; the publish button hides", async ({ page }) => {
    installRoutes(page, { employees: [{ ...draftEmp }] });
    await page.goto(`/employees/${draftEmp.id}?tab=config`);

    await page.getByTestId("employee-config-publish").click();
    await expect(page.getByTestId("employee-hero-status-published")).toBeVisible();
    await expect(page.getByTestId("employee-config-publish")).toHaveCount(0);
  });

  test("delete (soft) flips status to archived in-place + shows restore banner", async ({
    page,
  }) => {
    installRoutes(page, { employees: [{ ...draftEmp }] });
    await page.goto(`/employees/${draftEmp.id}?tab=config`);

    await page.getByTestId("employee-config-delete").click();
    // ConfirmDialog → confirm (scope to the dialog so we don't re-click the
    // toolbar delete button that opened it).
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^删除$|^Delete$/ })
      .click();

    // v3 soft-delete: detail page stays mounted, hero chip flips, banner shows.
    await expect(page.getByTestId("employee-hero-status-archived")).toBeVisible();
    await expect(page.getByTestId("employee-archived-banner")).toBeVisible();
    await expect(page.getByTestId("employee-archived-restore")).toBeVisible();
  });

  test("archived banner restore flips back to published", async ({ page }) => {
    const archivedEmp = { ...draftEmp, status: "archived" } satisfies Json;
    installRoutes(page, { employees: [archivedEmp] });
    await page.goto(`/employees/${draftEmp.id}`);

    await expect(page.getByTestId("employee-archived-banner")).toBeVisible();
    await page.getByTestId("employee-archived-restore").click();
    await expect(page.getByTestId("employee-hero-status-published")).toBeVisible();
    await expect(page.getByTestId("employee-archived-banner")).toHaveCount(0);
  });

  test("archived banner hard-delete → routes back to /employees", async ({
    page,
  }) => {
    const archivedEmp = { ...draftEmp, status: "archived" } satisfies Json;
    installRoutes(page, { employees: [archivedEmp] });
    await page.goto(`/employees/${draftEmp.id}`);

    await page.getByTestId("employee-archived-hard-delete").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^永久删除$|^Delete forever$/ })
      .click();
    await page.waitForURL(/\/employees(\?.*)?$/);
  });

  test("hero edit button switches to config tab in place", async ({ page }) => {
    installRoutes(page, { employees: [{ ...draftEmp }] });
    await page.goto(`/employees/${draftEmp.id}`);

    // Default tab is overview.
    await expect(page.getByTestId("employee-tab-overview")).toBeVisible();
    await page.getByTestId("employee-hero-edit").click();

    await expect(page.getByTestId("employee-tab-config")).toBeVisible();
    await expect(page).toHaveURL(/tab=config/);
  });
});
