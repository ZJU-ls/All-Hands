import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 配置:主要用于视觉回归 + 主路径 E2E 烟测。
 *
 * 运行前提:
 *   pnpm add -D @playwright/test && pnpm exec playwright install chromium
 *
 * 常用命令:
 *   pnpm exec playwright test                        # 全量
 *   pnpm exec playwright test --update-snapshots     # 首次生成/刷新 baseline(在你的机器上做一次)
 *   pnpm exec playwright test --ui                   # 交互式 debug
 *
 * 为什么只跑 chromium:减少 baseline 漂移,视觉契约只对一个引擎负责。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  expect: {
    toHaveScreenshot: {
      // Token/主题切换会产生 1-2px 抗锯齿差异,留出容忍带但不宽到放过真实回归。
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],

  // 如果你已经 `pnpm dev` 自己起了 server,playwright 会复用(reuseExistingServer)。
  // 否则 playwright 自己起一个。CI 场景(E2E_BASE_URL 被外部 compose 指向)把这段屏蔽掉。
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
