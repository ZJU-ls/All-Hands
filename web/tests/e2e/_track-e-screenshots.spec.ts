import { test } from "@playwright/test";
import path from "node:path";

/**
 * Track E · design-review screenshots(手动触发)
 *
 * 一次性脚本,把 Track E 视觉改动(icon · 扁平 nav · gateway tabs)截图
 * 存到 `docs/design-review/screenshots/`,方便 review 时对照。
 *
 * 默认 skip — 不是契约回归,没有 baseline,无需每次 CI 重跑。
 * 需要刷新截图时:
 *   TRACK_E_SCREENSHOTS=1 E2E_BASE_URL=http://localhost:3005 \
 *     pnpm exec playwright test _track-e-screenshots.spec.ts
 */

test.skip(
  !process.env.TRACK_E_SCREENSHOTS,
  "Track E screenshots are manual-only; set TRACK_E_SCREENSHOTS=1 to run.",
);

const OUT = path.resolve(__dirname, "../../../docs/design-review/screenshots");

const shots: Array<{ path: string; file: string; full?: boolean }> = [
  { path: "/design-lab", file: "01-design-lab-icon-gallery.png", full: true },
  { path: "/chat", file: "02-sidenav-chat.png" },
  { path: "/tasks", file: "03-sidenav-tasks.png" },
  { path: "/employees", file: "04-employees.png" },
  { path: "/gateway", file: "05-gateway-top-tabs.png" },
  { path: "/observatory", file: "06-observatory.png" },
  { path: "/skills", file: "07-skills.png" },
  { path: "/", file: "08-home.png" },
];

for (const shot of shots) {
  test(`screenshot ${shot.file}`, async ({ page }) => {
    await page.goto(shot.path, { waitUntil: "domcontentloaded" });
    // Some pages (chat, observatory) keep SSE open → networkidle never fires.
    // Give layout a beat to settle instead.
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(OUT, shot.file),
      fullPage: shot.full ?? false,
    });
  });
}
