import { test } from "@playwright/test";
import path from "node:path";

/**
 * Track E · detail crops(手动触发)· 见 _track-e-screenshots.spec.ts
 *
 *   TRACK_E_SCREENSHOTS=1 E2E_BASE_URL=http://localhost:3005 \
 *     pnpm exec playwright test _track-e-sidebar-crop.spec.ts
 */

test.skip(
  !process.env.TRACK_E_SCREENSHOTS,
  "Track E detail crops are manual-only; set TRACK_E_SCREENSHOTS=1 to run.",
);

const OUT = path.resolve(__dirname, "../../../docs/design-review/screenshots");

test("sidebar crop with icons visible", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const sidebar = page.locator("aside").first();
  await sidebar.screenshot({ path: path.join(OUT, "09-sidebar-detail.png") });
});

test("gateway top tabs crop", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/gateway", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(OUT, "10-gateway-top-tabs-detail.png"),
    clip: { x: 224, y: 0, width: 1176, height: 140 },
  });
});

test("icon gallery crop", async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/design-lab", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const gallery = page.locator('[data-testid="icon-gallery"]');
  await gallery.waitFor({ state: "attached", timeout: 30000 });
  // design-lab wraps content in h-screen overflow-y-auto; window scroll
  // doesn't move the inner scroll container, so scroll it directly.
  await gallery.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  await gallery.screenshot({
    path: path.join(OUT, "11-icon-gallery-detail.png"),
  });
});
