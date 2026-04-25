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
  kind: "openai" | "anthropic" | "aliyun";
  base_url: string;
  api_key_set: boolean;
  enabled: boolean;
};

type Preset = {
  kind: "openai" | "anthropic" | "aliyun";
  label: string;
  base_url: string;
  default_model: string;
  key_hint: string;
  doc_hint: string;
};

const PRESETS: Preset[] = [
  {
    kind: "openai",
    label: "OpenAI 兼容",
    base_url: "https://api.openai.com/v1",
    default_model: "gpt-4o-mini",
    key_hint: "sk-...",
    doc_hint: "OpenAI / OpenRouter / DeepSeek / Ollama / vLLM — Authorization: Bearer",
  },
  {
    kind: "anthropic",
    label: "Anthropic",
    base_url: "https://api.anthropic.com",
    default_model: "claude-3-5-sonnet-latest",
    key_hint: "sk-ant-...",
    doc_hint: "Anthropic Messages API — x-api-key + anthropic-version",
  },
  {
    kind: "aliyun",
    label: "阿里云 百炼",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    default_model: "qwen-plus",
    key_hint: "sk-...",
    doc_hint: "DashScope compatible-mode — OpenAI 兼容 wire,Qwen 系列",
  },
];

async function mockPresets(page: import("@playwright/test").Page) {
  await page.route("**/api/providers/presets", async (route) => {
    await route.fulfill({ json: PRESETS });
  });
}

type Model = {
  id: string;
  provider_id: string;
  name: string;
  display_name: string;
  context_window: number;
  enabled: boolean;
  is_default: boolean;
};

test.describe("gateway · accordion 三态 + ConfirmDialog + ping", () => {
  test("empty → add first provider → confirm delete", async ({ page }) => {
    let providers: Provider[] = [];
    const models: Model[] = [];

    await mockPresets(page);
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
            kind: (body.kind as Provider["kind"]) ?? "openai",
            base_url: String(body.base_url ?? ""),
            api_key_set: true,
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
    await page.locator('input[type="password"]').fill("sk-test");
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
        kind: "openai",
        base_url: "https://demo.example.com/v1",
        api_key_set: true,
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
        is_default: true,
      },
      {
        id: "m-fail",
        provider_id: "p1",
        name: "broken-model",
        display_name: "Broken",
        context_window: 4096,
        enabled: true,
        is_default: false,
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

test.describe("gateway · 供应商格式 UX", () => {
  test("add dialog: picking format autofills base_url (default model is picked later on a model row)", async ({
    page,
  }) => {
    let providers: Provider[] = [];
    await mockPresets(page);
    let postBody: Record<string, unknown> | null = null;
    await page.route("**/api/providers", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: providers });
        return;
      }
      if (route.request().method() === "POST") {
        postBody = route.request().postDataJSON() as Record<string, unknown>;
        providers = [
          {
            id: "new-anthropic",
            name: String(postBody.name ?? ""),
            kind: (postBody.kind as Provider["kind"]) ?? "openai",
            base_url: String(postBody.base_url ?? ""),
            api_key_set: true,
            enabled: true,
          },
        ];
        await route.fulfill({ json: providers[0], status: 201 });
        return;
      }
      await route.continue();
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto("/gateway");
    await expect(page.getByTestId("gateway-empty")).toBeVisible();
    await page.getByText("添加第一个供应商 →").click();

    // All 3 format tiles are visible; openai is selected by default.
    await expect(page.getByTestId("provider-kind-openai")).toBeVisible();
    await expect(page.getByTestId("provider-kind-anthropic")).toBeVisible();
    await expect(page.getByTestId("provider-kind-aliyun")).toBeVisible();
    await expect(page.getByTestId("provider-kind-openai")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Click anthropic — only base_url autofills now. The "default model"
    // field was retired; the user picks a default by clicking 「设为默认」
    // on a registered model row instead. Form must show the explanatory hint.
    await page.getByTestId("provider-kind-anthropic").click();
    await expect(page.getByTestId("provider-kind-anthropic")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const baseUrlInput = page.locator('input[placeholder*="https://"]').first();
    await expect(baseUrlInput).toHaveValue("https://api.anthropic.com");
    await expect(page.getByTestId("provider-form-default-hint")).toBeVisible();
    // No default-model input lingers in the form.
    await expect(
      page.locator('input[value="claude-3-5-sonnet-latest"]'),
    ).toHaveCount(0);

    // Fill name + key and save — POST body must NOT carry default_model.
    await page
      .getByPlaceholder("例: OpenAI / DeepSeek / 本地 Ollama")
      .fill("MyAnthropic");
    await page.getByPlaceholder("sk-ant-...").fill("sk-ant-test");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByTestId("gateway-provider-MyAnthropic")).toBeVisible();
    await expect(
      page.getByTestId("gateway-provider-kind-MyAnthropic"),
    ).toHaveText("ANTHROPIC");
    expect(postBody).not.toBeNull();
    const body = postBody as unknown as Record<string, unknown>;
    expect(body.kind).toBe("anthropic");
    expect(body.default_model).toBeUndefined();
    expect(body.set_as_default).toBeUndefined();
  });
});
