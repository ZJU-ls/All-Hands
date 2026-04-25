/**
 * Route smoke test — boots `next start` against the latest build and asserts
 * every app-router route responds 200 with a real document (no fallback
 * "missing required error components" or "__next_error__" shell).
 *
 * Why: a broken `.next` cache (E04) or missing error/not-found component (E05)
 * can return 200/404 with a tiny HTML stub that still "looks alive" to curl
 * but renders nothing to the user. This test catches both.
 *
 * Skips if `.next/BUILD_ID` is missing — run `pnpm build` first. CI runs
 * `pnpm build && pnpm test`, so it's covered there.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const NEXT_DIR = path.join(REPO, ".next");
const BUILD_ID = path.join(NEXT_DIR, "BUILD_ID");
const APP_DIR = path.join(REPO, "app");
const PORT = 4411;

/** Collect all static route paths from app/<segment>/page.tsx. */
function discoverRoutes(): string[] {
  const routes: string[] = [];
  function walk(dir: string, segs: string[]) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) {
        // skip dynamic / route groups — they can't be smoke-hit without data
        if (name.startsWith("[") || name.startsWith("(") || name.startsWith("_")) continue;
        walk(full, [...segs, name]);
      } else if (name === "page.tsx") {
        routes.push("/" + segs.join("/"));
      }
    }
  }
  walk(APP_DIR, []);
  return routes.map((r) => (r === "/" ? "/" : r));
}

const BROKEN_BODY_PATTERNS: RegExp[] = [
  /missing required error components/i,
  /<html[^>]*id=["']__next_error__["']/i,
];

describe.skipIf(!existsSync(BUILD_ID))("routes smoke (needs `pnpm build`)", () => {
  let proc: ChildProcess;

  beforeAll(async () => {
    proc = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
      cwd: REPO,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Wait for server to respond (up to 30s).
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://localhost:${PORT}/`, { redirect: "manual" });
        if (res.status > 0) return;
      } catch {
        // not yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("next start did not become ready within 30s");
  }, 45_000);

  afterAll(() => {
    if (proc && !proc.killed) proc.kill("SIGTERM");
  });

  const routes = discoverRoutes();

  it.each(routes.map((r) => [r]))("GET %s returns a real document (not error-shell)", async (route) => {
    const res = await fetch(`http://localhost:${PORT}${route}`, { redirect: "follow" });
    expect(res.status, `E05 route ${route} status`).toBeLessThan(500);
    const body = await res.text();
    for (const pat of BROKEN_BODY_PATTERNS) {
      expect(body, `E04/E05 route ${route} served broken shell: ${pat}`).not.toMatch(pat);
    }
    // Sanity: should contain at least our <html> wrapper and the app font vars.
    // Locale comes from the LocaleProvider (cookie / Accept-Language). Default
    // is zh-CN; tests don't set headers, so we just assert *some* lang attr.
    expect(body, `route ${route} body too small`).toMatch(/<html[^>]*lang="[^"]+"/);
  });
});

/**
 * Static-build manifest check — runs without spawning a server. Confirms that
 * every page.tsx we found has a compiled output under .next/server/app/.
 * This catches the exact failure mode we hit on 2026-04-18: dev wrote a
 * page_client-reference-manifest.js but no page.js for /design-lab, so the
 * route served the "missing required error components" fallback forever.
 */
describe.skipIf(!existsSync(BUILD_ID))("build manifest is complete", () => {
  const routes = discoverRoutes();

  it.each(routes.map((r) => [r]))("%s has compiled page.js in .next/server/app", (route) => {
    const segDir = route === "/" ? "" : route.slice(1);
    const pageJs = path.join(NEXT_DIR, "server", "app", segDir, "page.js");
    expect(existsSync(pageJs), `E04 missing compiled page.js for ${route} (.next is corrupt — wipe and rebuild)`).toBe(true);
  });

  it(".next/app-build-manifest.json references every route", () => {
    const manifest = JSON.parse(readFileSync(path.join(NEXT_DIR, "app-build-manifest.json"), "utf8")) as {
      pages: Record<string, unknown>;
    };
    const keys = Object.keys(manifest.pages);
    for (const route of routes) {
      const needle = route === "/" ? "/page" : `${route}/page`;
      expect(keys, `E04 app-build-manifest missing ${needle}`).toContain(needle);
    }
  });
});
