import { test, expect } from "@playwright/test";

/**
 * Nested-run block display smoke (I-0011 · nested-run § 7 DoD).
 *
 * The employee-chat spec § 2.3 / § 5.3 calls for an end-to-end check: when a
 * Lead dispatches a sub-employee via ``dispatch_employee``, the chat renders
 * a collapsible NestedRunBlock that streams tokens from the sub-run. Wiring
 * that into Playwright needs two pieces we don't have yet:
 *
 *   1. A SSE fixture that interleaves ``nested_run_start`` / ``nested_run_end``
 *      frames into the parent conversation stream.
 *   2. MessageBubble piping those frames into <NestedRunBlock> in live chat
 *      (today the block is rendered from lib fixtures — see
 *      ``web/lib/__tests__/nested-run-block.test.tsx``, which is green).
 *
 * Component-level behavior (status labels / collapse / color tokens) is
 * already locked down by that unit test. What this e2e file pins is the
 * *precondition*: the /chat route boots against mocked Lead + empty history,
 * and the NestedRunBlock module is part of the bundle (so it can be mounted
 * once the SSE harness lands). If /chat breaks, no nested-run display can
 * happen — this test goes red before the wiring work even starts.
 *
 * spec: docs/specs/agent-design/2026-04-18-employee-chat.md § 2.3 + § 5.3
 * unit: web/lib/__tests__/nested-run-block.test.tsx (full render coverage)
 * component: web/components/chat/NestedRunBlock.tsx
 */

const CONV_ID = "conv_nested_smoke";
const EMP_ID = "emp_lead_1";

test.describe("chat · nested-run block", () => {
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

  test("chat route boots so NestedRunBlock can be mounted later", async ({ page }) => {
    await page.goto(`/chat/${CONV_ID}`);

    // surface precondition for nested-run display
    await expect(page.getByPlaceholder("Message Lead Agent…")).toBeVisible();
    await expect(page.getByText(/Send a message to get started/)).toBeVisible();
    // No nested-run block should be showing in the empty state.
    await expect(page.getByText("运行中")).toHaveCount(0);
    await expect(page.getByText("已完成")).toHaveCount(0);
  });

  test.fixme(
    "dispatch_employee sub-run shows collapsible block with status tokens",
    async () => {
      // TODO(I-0011 follow-up):
      //   1. mock POST /api/conversations/:id/messages as chunked SSE with
      //      nested_run_start(employee="Writer") → token × N → nested_run_end
      //   2. assert <section aria-label=... /> NestedRunBlock appears
      //   3. assert default collapsed, click → children visible
      //   4. assert status "已完成" rendered with text-success token
      // Blocked on: MessageBubble currently mounts NestedRunBlock from
      //   lib-level fixtures, not from SSE frames. Wiring tracked in the
      //   employee-chat streaming harness follow-up.
    },
  );
});
