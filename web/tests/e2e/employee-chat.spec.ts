import { test, expect } from "@playwright/test";

/**
 * Employee-chat smoke (I-0011 · employee-chat § 9 DoD).
 *
 * The spec's acceptance matrix wants a full send → token-stream → render
 * round-trip. That requires a streaming SSE fake plus the zustand store
 * asserting on tokens as they arrive — a real mini harness, not a one-shot
 * mock. Tracked as test.fixme below.
 *
 * What this file pins is the *surface*: /chat boots against mocked backend
 * endpoints, the InputBar + MessageList render, and the employee header
 * shows the Lead's name. If the chat route loses its core composition (e.g.
 * someone accidentally removes the InputBar), this test goes red before the
 * stream harness has a chance to.
 *
 * spec: docs/specs/agent-design/2026-04-18-employee-chat.md § 9
 * route: web/app/chat/[conversationId]/page.tsx
 */

const CONV_ID = "conv_chat_smoke";
const EMP_ID = "emp_lead_1";

test.describe("employee-chat · surface", () => {
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

  test("chat page renders InputBar + MessageList + Lead header", async ({ page }) => {
    await page.goto(`/chat/${CONV_ID}`);

    await expect(page.getByPlaceholder("Message Lead Agent…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(page.getByText(/Send a message to get started/)).toBeVisible();
    await expect(page.getByText("Lead").first()).toBeVisible();
  });

  test.fixme(
    "send message → SSE token stream → assistant bubble grows token-by-token",
    async () => {
      // TODO(I-0011 follow-up):
      //   1. mock POST /api/conversations/:id/messages with a chunked
      //      text/event-stream response (token/tool_call_start/done frames)
      //   2. type a message + Enter, assert that the assistant bubble appears
      //      and the content grows as tokens are appended
      //   3. assert `done` frame clears the streaming state
      // Blocked on: Playwright can serve a streamed response via page.route
      //   + readable streams, but designing the fixture so it round-trips
      //   through the real InputBar → store path is a sit-down exercise.
    },
  );
});
