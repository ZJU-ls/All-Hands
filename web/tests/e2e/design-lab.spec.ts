import { test, expect } from "@playwright/test";

/**
 * design-lab 是视觉契约的活样本(product/03-visual-design.md + design-system/MASTER.md)。
 * 它必须一直长得跟 baseline 一样 —— 如果这张图变了,要么是故意改了视觉契约
 * (那就同步更新 baseline + 契约文档),要么是引入了意外回归。
 *
 * 首次运行(在你自己的机器上):
 *   pnpm exec playwright test --update-snapshots
 * 把 __screenshots__/design-lab.spec.ts/*.png 提交到 git。
 */
test.describe("design-lab 视觉回归", () => {
  test("page renders and matches baseline", async ({ page }) => {
    await page.goto("/design-lab");
    await expect(page).toHaveTitle(/design|allhands/i);
    // 让字体 & 延迟加载稳定下来,避免第一屏还在抖的时候截图
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("design-lab-light.png", {
      fullPage: true,
    });
  });
});
