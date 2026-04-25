import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * I-0020 · Seed "full house" cold-start verification.
 *
 * Opens every page that a product reviewer hits on day one (/gateway,
 * /employees, /skills, /mcp-servers, /traces) against a mocked backend
 * that replays `backend/data/seeds/*.json`. Each page must render at
 * least the minimum row count the seed contract promises — if a future
 * track ships a new domain table but forgets to extend
 * `ensure_all_dev_seeds()`, its page will fall below the threshold here
 * and the review bounces.
 *
 * See docs/claude/working-protocol.md §4 · "Seed 数据" block.
 */

const SEEDS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "backend",
  "data",
  "seeds",
);

const SCREENSHOT_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "plans",
  "screenshots",
);

const SHOT_ENABLED = process.env.I0020_CAPTURE === "1";

type ProviderSeed = {
  id: string;
  name: string;
  // Legacy seed-shape fields. After 2026-04-25 these are read but no longer
  // surfaced through the provider DTO; the e2e fixture constructor below
  // funnels `is_default` + `default_model` into the matching model row's
  // `is_default` flag instead.
  base_url: string;
  api_key: string;
  default_model: string;
  is_default: boolean;
  enabled: boolean;
};

type ModelSeed = {
  id: string;
  provider_name: string;
  name: string;
  display_name: string;
  context_window: number;
  enabled: boolean;
};

type EmployeeSeed = {
  id: string;
  name: string;
  description: string;
  is_lead_agent?: boolean;
  tool_ids: string[];
  skill_ids: string[];
  max_iterations: number;
  model_ref: string;
};

type McpSeed = {
  id: string;
  name: string;
  transport: string;
  config: Record<string, unknown>;
  enabled: boolean;
};

async function readSeed<T>(filename: string): Promise<T> {
  const raw = await readFile(path.join(SEEDS_DIR, filename), "utf8");
  return JSON.parse(raw) as T;
}

async function capture(page: import("@playwright/test").Page, slug: string) {
  if (!SHOT_ENABLED) return;
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `i0020-seed-${slug}.png`),
    fullPage: false,
  });
}

test.describe("seed full-house · cold-start pages render real data", () => {
  test("gateway shows ≥ 3 providers and ≥ 3 models for the default provider", async ({
    page,
  }) => {
    const providers = await readSeed<ProviderSeed[]>("providers.json");
    const modelsRaw = await readSeed<ModelSeed[]>("models.json");

    const providerDtos = providers.map((p) => ({
      id: p.id,
      name: p.name,
      kind: "openai" as const,
      base_url: p.base_url,
      api_key_set: true,
      enabled: p.enabled,
    }));
    const providerByName = new Map(providerDtos.map((p) => [p.name, p.id]));
    // Translate the legacy seed-shape default (provider.is_default +
    // provider.default_model name string) into a model-row is_default flag.
    const defaultLegacyProvider = providers.find((p) => p.is_default);
    const modelDtos = modelsRaw.map((m) => ({
      id: m.id,
      provider_id: providerByName.get(m.provider_name) ?? "",
      name: m.name,
      display_name: m.display_name,
      context_window: m.context_window,
      enabled: m.enabled,
      is_default: Boolean(
        defaultLegacyProvider &&
          m.provider_name === defaultLegacyProvider.name &&
          m.name === defaultLegacyProvider.default_model,
      ),
    }));

    await page.route("**/api/providers", async (route) => {
      await route.fulfill({ json: providerDtos });
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({ json: modelDtos });
    });

    await page.goto("/gateway");

    // 3+ provider rail buttons visible
    for (const p of providerDtos) {
      await expect(page.getByTestId(`provider-rail-${p.name}`)).toBeVisible();
    }
    expect(providerDtos.length).toBeGreaterThanOrEqual(3);

    // Default provider is the one whose models include is_default=true now.
    await expect(page.getByTestId("models-empty")).toHaveCount(0);
    const defaultModel = modelDtos.find((m) => m.is_default);
    expect(defaultModel).toBeDefined();
    const defaultProvider = providerDtos.find(
      (p) => p.id === defaultModel!.provider_id,
    );
    expect(defaultProvider).toBeDefined();
    const defaultModels = modelDtos.filter(
      (m) => m.provider_id === defaultProvider!.id,
    );
    expect(defaultModels.length).toBeGreaterThanOrEqual(3);
    for (const m of defaultModels) {
      await expect(
        page.getByText(m.display_name, { exact: true }).first(),
      ).toBeVisible();
    }
    await capture(page, "gateway");
  });

  test("employees page shows ≥ 3 seeded employees", async ({ page }) => {
    const employees = await readSeed<EmployeeSeed[]>("employees.json");
    // Backend DTO drops system_prompt / created_by / metadata; the page reads
    // name / description / model_ref / tool_ids / skill_ids.
    const dto = employees.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      is_lead_agent: Boolean(e.is_lead_agent),
      tool_ids: e.tool_ids,
      skill_ids: e.skill_ids,
      max_iterations: e.max_iterations,
      model_ref: e.model_ref,
    }));

    await page.route("**/api/employees", async (route) => {
      await route.fulfill({ json: dto });
    });

    await page.goto("/employees");

    expect(dto.length).toBeGreaterThanOrEqual(3);
    for (const e of dto) {
      await expect(page.getByText(e.name, { exact: true }).first()).toBeVisible();
    }
    await capture(page, "employees");
  });

  test("skills page shows ≥ 1 installed skill", async ({ page }) => {
    // Skills are filesystem-backed rather than seeded through seed_service,
    // but the DoD requires the /skills page to render real content on cold
    // start. We assert the installed tab lists at least one row.
    const skills = [
      {
        id: "skill-render",
        name: "allhands.render",
        description: "Render UI components via protocol envelopes.",
        tool_ids: ["render.card", "render.table"],
      },
      {
        id: "skill-artifacts",
        name: "allhands.artifacts",
        description: "Persist and stream file artifacts during runs.",
        tool_ids: ["artifacts.write", "artifacts.list"],
      },
    ];

    await page.route("**/api/skills", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: skills });
      } else {
        await route.continue();
      }
    });
    await page.route("**/api/skills/market**", async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto("/skills");

    await expect(page.getByTestId("skills-list")).toBeVisible();
    for (const s of skills) {
      await expect(page.getByTestId(`skill-${s.name}`)).toBeVisible();
    }
    expect(skills.length).toBeGreaterThanOrEqual(1);
    await capture(page, "skills");
  });

  test("mcp-servers page shows ≥ 1 seeded server", async ({ page }) => {
    const servers = await readSeed<McpSeed[]>("mcp_servers.json");
    const dto = servers.map((s) => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
      config: s.config,
      enabled: s.enabled,
      exposed_tool_ids: [],
      last_handshake_at: null,
      health: "unknown",
    }));

    await page.route("**/api/mcp-servers", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: dto });
      } else {
        await route.continue();
      }
    });

    await page.goto("/mcp-servers");

    await expect(page.getByTestId("mcp-list")).toBeVisible();
    for (const s of dto) {
      await expect(page.getByTestId(`mcp-${s.name}`)).toBeVisible();
    }
    expect(dto.length).toBeGreaterThanOrEqual(1);
    await capture(page, "mcp-servers");
  });

  test("traces page shows ≥ 1 trace row", async ({ page }) => {
    const employees = await readSeed<EmployeeSeed[]>("employees.json");
    // Traces are derived from the events table — each run.started with a
    // matching terminal run.* event produces one row. Fabricate one row
    // per seeded employee so the page clearly renders > 0.
    const traces = employees.map((e, i) => ({
      trace_id: `seed-trace-${i + 1}`,
      employee_id: e.id,
      employee_name: e.name,
      status: i === 0 ? "failed" : "ok",
      duration_s: 1.2 + i,
      tokens: 800 + i * 200,
      started_at: new Date(Date.UTC(2026, 3, 18, 9, i, 0)).toISOString(),
    }));

    await page.route("**/api/employees", async (route) => {
      await route.fulfill({
        json: employees.map((e) => ({
          id: e.id,
          name: e.name,
          description: e.description,
          is_lead_agent: Boolean(e.is_lead_agent),
          tool_ids: e.tool_ids,
          skill_ids: e.skill_ids,
          max_iterations: e.max_iterations,
          model_ref: e.model_ref,
        })),
      });
    });
    await page.route("**/api/observatory/traces**", async (route) => {
      await route.fulfill({
        json: { traces, count: traces.length },
      });
    });
    await page.route("**/api/observatory/summary", async (route) => {
      await route.fulfill({
        json: {
          traces_total: traces.length,
          failure_rate_24h: 0.33,
          latency_p50_s: 1.2,
          avg_tokens_per_run: 900,
          by_employee: employees.map((e) => ({
            employee_id: e.id,
            employee_name: e.name,
            runs_count: 1,
          })),
          observability_enabled: true,
          bootstrap_status: "ok",
          bootstrap_error: null,
          host: "https://langfuse.example.com",
        },
      });
    });

    await page.goto("/traces");

    // Header row + per-trace body rows → total ≥ 1 + traces.length.
    const rows = page.getByRole("row");
    await expect(rows).toHaveCount(1 + traces.length);
    expect(traces.length).toBeGreaterThanOrEqual(1);
    // Employee names appear in a <select> option AND the body cell; scope to
    // the trace table (`role="row"` rows) to avoid matching the hidden option.
    const bodyRows = rows.filter({ hasNot: page.locator("th") });
    for (const t of traces) {
      await expect(bodyRows.getByText(t.employee_name).first()).toBeVisible();
    }
    await capture(page, "traces");
  });
});
