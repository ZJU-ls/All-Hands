import { test, expect } from "@playwright/test";

/**
 * Artifacts-panel smoke (I-0011 · artifacts-panel § 10 DoD).
 *
 * The full flow from `docs/specs/agent-design/2026-04-18-artifacts-panel.md § 10`
 * has three acceptance beats:
 *   1. /chat 打开制品面板 · 首次 empty state
 *   2. 员工 render 出 markdown artifact · 面板刷新 · 出现在列表
 *   3. 点击进入详情 · pin / unpin / 版本切换
 *
 * Beat 2-3 depend on a live SSE stream writing into the workspace artifact
 * store (or a page.evaluate harness that pokes artifacts-api). That's real work
 * and belongs in a follow-up. What this file pins is beat 1 — the route
 * `/chat/*` can boot, the 制品 toggle is present, and the ArtifactPanel
 * renders against a mocked empty /api/artifacts list.
 *
 * If any of this regresses, the artifact-panel entry point is broken before
 * users ever see an artifact, so the full flow can't matter.
 *
 * spec: docs/specs/agent-design/2026-04-18-artifacts-panel.md § 10
 * route: web/app/chat/[conversationId]/page.tsx
 */

const CONV_ID = "conv_smoke_1";
const EMP_ID = "emp_lead_1";

test.describe("chat · 制品面板", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/employees/lead", (route) =>
      route.fulfill({ json: { id: EMP_ID } }),
    );
    await page.route(`**/api/employees/${EMP_ID}`, (route) =>
      route.fulfill({
        json: {
          id: EMP_ID,
          name: "Lead",
          description: "Lead agent",
          is_lead_agent: true,
          tool_ids: [
            "allhands.meta.list_employees",
            "allhands.meta.get_employee_detail",
            "allhands.meta.dispatch_employee",
          ],
          skill_ids: [],
          max_iterations: 12,
          model_ref: "openai/gpt-4o-mini",
        },
      }),
    );
    await page.route("**/api/conversations", (route) =>
      route.fulfill({ json: { id: CONV_ID } }),
    );
    await page.route(`**/api/conversations/${CONV_ID}`, (route) =>
      route.fulfill({
        json: {
          id: CONV_ID,
          employee_id: EMP_ID,
          title: null,
          created_at: new Date().toISOString(),
        },
      }),
    );
    await page.route(`**/api/conversations/${CONV_ID}/messages`, (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route("**/api/artifacts**", (route) => route.fulfill({ json: [] }));
  });

  test("toggle opens the panel and renders the empty state", async ({ page }) => {
    await page.goto(`/chat/${CONV_ID}`);

    const toggle = page.getByRole("button", { name: "切换制品区" });
    await expect(toggle).toBeVisible();
    await toggle.click();

    const panel = page.getByRole("complementary", { name: "制品区" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/还没有制品/)).toBeVisible();
  });

  test.fixme(
    "artifact created via SSE appears in panel list + detail pin round-trip",
    async () => {
      // TODO(I-0011 follow-up):
      //   1. seed one artifact into the mocked /api/artifacts response
      //   2. trigger a page.evaluate(() => window.dispatchEvent(new Event('artifact_changed')))
      //      or re-fetch (panel polls every 10s) to confirm the list updates
      //   3. click the row → ArtifactDetail; click 置顶 → PATCH /api/artifacts/:id
      // Blocked on: no dedicated artifact-write test hook yet (end-to-end
      // would need a mini fake backend — out of scope for the smoke skeleton).
    },
  );
});
