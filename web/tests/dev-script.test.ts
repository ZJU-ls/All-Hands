import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * L08 regression guards.
 *
 * These are flow/contract assertions, not runtime behavior. They protect the
 * two decisions that root-caused the 14s "click → jump" lag:
 *
 *   1. The dev script must keep `--turbopack` — webpack dev cold-compile was
 *      2-14s per route; Turbopack drops that to 200-600ms per route.
 *   2. AppShell must NOT statically import CommandPalette — its module
 *      graph must stay behind `next/dynamic` so it doesn't inflate every
 *      route's cold compile. Early-return (`if (!open) return null`) is a
 *      render-time optimization and does NOT exclude a module from the
 *      compile graph.
 *
 *      (The companion lazy gate for RunTraceDrawer was retired on
 *      2026-04-27 when trace viewing moved into the observatory L3 page —
 *      /observatory/runs/[id] — and the global drawer was deleted.)
 *
 * See docs/claude/learnings.md § L08.
 */

const ROOT = resolve(__dirname, "..");

describe("L08 · dev ergonomics regression guards", () => {
  it("package.json dev script keeps --turbopack", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toMatch(/--turbopack\b/);
  });

  it("AppShell keeps CommandPalette behind next/dynamic", () => {
    const src = readFileSync(
      resolve(ROOT, "components/shell/AppShell.tsx"),
      "utf8",
    );
    // No top-level `import { CommandPalette } from "@/components/ui/CommandPalette"`
    // — `next/dynamic` is fine (it produces an `import(...)` call, not a
    // static `import X from` declaration).
    const importCommandPalette =
      /^\s*import\s*(?:\{[^}]*\b(?:CommandPalette)\b[^}]*\}|\w+)\s*from\s*["']@\/components\/ui\/CommandPalette["']/m;
    expect(src).not.toMatch(importCommandPalette);
    // And the dynamic form IS present — don't let a future refactor silently
    // remove the lazy gate by inlining a usage.
    expect(src).toMatch(
      /dynamic\s*\(\s*\(\)\s*=>\s*import\(\s*["']@\/components\/ui\/CommandPalette["']/,
    );
  });

  it("RunTraceDrawer is mounted at the AppShell level and lazy-loaded", () => {
    // 2026-04-28 reversed the 2026-04-27 trace-into-observatory regression.
    // Trace chips in chat used to <Link>-navigate to /observatory/runs/[id]
    // and unmount the chat page mid-stream — killing spawn_subagent and
    // partial token output. Drawer is back, mounted globally, lazy-loaded so
    // the bundle cost stays at ~0 for routes that never trigger it.
    const drawerPath = resolve(ROOT, "components/runs/RunTraceDrawer.tsx");
    expect(() => readFileSync(drawerPath, "utf8")).not.toThrow();

    const appShell = readFileSync(
      resolve(ROOT, "components/shell/AppShell.tsx"),
      "utf8",
    );
    // It must be dynamic-imported (lazy) — eager import would re-couple the
    // RunTracePanel + observatory-api bundle into every chat cold-compile.
    expect(appShell).toMatch(
      /dynamic\s*\(\s*\(\)\s*=>\s*import\(\s*["']@\/components\/runs\/RunTraceDrawer["']/,
    );
    // And it must be rendered.
    expect(appShell).toMatch(/<RunTraceDrawer\s*\/>/);
  });

  it("the ⌘K keydown listener lives in AppShell, not inside CommandPalette", () => {
    // CommandPalette's own ⌘K listener was removed so the palette module can
    // stay lazy-loaded until first open. If someone re-adds it, it'll double-
    // toggle with AppShell's listener AND force eager load.
    const cp = readFileSync(
      resolve(ROOT, "components/ui/CommandPalette.tsx"),
      "utf8",
    );
    expect(cp).not.toMatch(/key\.toLowerCase\(\)\s*===\s*["']k["']/);

    const shell = readFileSync(
      resolve(ROOT, "components/shell/AppShell.tsx"),
      "utf8",
    );
    expect(shell).toMatch(/key\.toLowerCase\(\)\s*===\s*["']k["']/);
  });
});
