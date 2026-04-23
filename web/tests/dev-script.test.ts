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
 *   2. AppShell must NOT statically import the two global overlays
 *      (CommandPalette, RunTraceDrawer) — their module graphs must stay
 *      behind `next/dynamic` so they don't inflate every route's cold
 *      compile. Early-return (`if (!open) return null`) is a render-time
 *      optimization and does NOT exclude a module from the compile graph.
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

  it("AppShell does not statically import CommandPalette or RunTraceDrawer", () => {
    const src = readFileSync(
      resolve(ROOT, "components/shell/AppShell.tsx"),
      "utf8",
    );
    // No top-level `import { CommandPalette } from "@/components/ui/CommandPalette"`
    // or equivalent for RunTraceDrawer. `next/dynamic` is fine (it produces an
    // `import(...)` call, not a static `import X from` declaration).
    const importCommandPalette =
      /^\s*import\s*(?:\{[^}]*\b(?:CommandPalette)\b[^}]*\}|\w+)\s*from\s*["']@\/components\/ui\/CommandPalette["']/m;
    const importRunTraceDrawer =
      /^\s*import\s*(?:\{[^}]*\b(?:RunTraceDrawer)\b[^}]*\}|\w+)\s*from\s*["']@\/components\/runs\/RunTraceDrawer["']/m;
    expect(src).not.toMatch(importCommandPalette);
    expect(src).not.toMatch(importRunTraceDrawer);
    // And the dynamic form IS present — don't let a future refactor silently
    // remove the lazy gate by inlining a usage.
    expect(src).toMatch(/dynamic\s*\(\s*\(\)\s*=>\s*import\(\s*["']@\/components\/ui\/CommandPalette["']/);
    expect(src).toMatch(/dynamic\s*\(\s*\(\)\s*=>\s*import\(\s*["']@\/components\/runs\/RunTraceDrawer["']/);
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
