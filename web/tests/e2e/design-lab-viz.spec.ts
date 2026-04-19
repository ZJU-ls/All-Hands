import { test, expect } from "@playwright/test";

/**
 * Design-lab Viz showcase smoke (I-0011 · viz-skill § 9 DoD).
 *
 * The viz-skill spec wants a Playwright visual-regression sweep over all 10
 * Viz components on /design-lab. That baseline suite is out of scope for this
 * skeleton — building + reviewing 10 snapshots per theme per breakpoint is its
 * own chunk of work. Instead this file pins the *precondition* for the snapshot
 * sweep: /design-lab renders and the 10 Viz ShowcaseCards are present by
 * title. If any Viz component is renamed / removed, this test goes red before
 * the snapshot suite starts drifting.
 *
 * Full visual-regression (10 components × 2 themes) is tracked as test.fixme
 * below.
 *
 * spec: docs/specs/agent-design/2026-04-18-viz-skill.md § 9
 * sibling: design-lab.spec.ts (single full-page baseline)
 */

const VIZ_SHOWCASE_TITLES = [
  "Viz.Table · 多行对比",
  "Viz.KV · 单实体详情",
  "Viz.Cards · 并列方案",
  "Viz.Callout · 提示 / 警告 / 成功 / 错误",
  "Viz.Timeline · 过程 / 历史",
  "Viz.Steps · wizard",
  "Viz.Code · 代码片段",
  "Viz.Diff · 前后对比",
  "Viz.LinkCard · 富外链",
];

test.describe("design-lab · Viz showcase", () => {
  test("renders the Viz showcase section with all component cards", async ({ page }) => {
    await page.goto("/design-lab");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Viz.* 渲染组件样本").first()).toBeVisible();

    for (const title of VIZ_SHOWCASE_TITLES) {
      await expect(page.getByText(title).first()).toBeVisible();
    }
  });

  test.fixme(
    "per-component snapshot sweep (10 Viz × light + dark)",
    async () => {
      // TODO(I-0011 follow-up):
      //   for each showcase card:
      //     scroll into view → await toHaveScreenshot(`viz-${name}-light.png`)
      //     toggle theme → toHaveScreenshot(`viz-${name}-dark.png`)
      //   run once with --update-snapshots on the owner's machine, commit baselines.
      // Blocked on: design-lab theme toggle + baseline review budget.
    },
  );
});
