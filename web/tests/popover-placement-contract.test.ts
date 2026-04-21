/**
 * Popover placement contract · product/03-visual-design.md § 3.9.
 *
 * Any file that positions a panel with `top-full` or `bottom-full` against an
 * `absolute`-positioned ancestor must also:
 *   (a) import `computePopoverSide` from `@/lib/popover-placement`, AND
 *   (b) reference BOTH `top-full` and `bottom-full` (the ternary flip branch).
 *
 * Hard-coded directions cause the two predictable bugs the user flagged on
 * 2026-04-21:
 *   - always-`bottom-full` → chat-header chips overlap AppShell's menu bar
 *   - always-`top-full`    → near the viewport edge the panel goes off-screen
 *
 * This test is a static scan — it doesn't simulate runtime placement, only
 * that the flip wiring is present. Behavioral coverage lives in
 * `popover-placement.test.ts` and each consumer's own tests.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

// Allow-list: files where a bare top-full or bottom-full is OK because the
// panel is positionally-stable (e.g. a decorative `top-full` border accent,
// or a docked sidebar). Keep this list tiny and justify each entry.
const ALLOWLIST = new Set<string>([
  // computePopoverSide itself + its unit tests — the source of truth, not a
  // consumer.
  "lib/popover-placement.ts",
  "lib/__tests__/popover-placement.test.ts",
  // This contract test file — talks about both directions in its literal
  // documentation and the banned-examples grep.
  "tests/popover-placement-contract.test.ts",
  // Visual spec file (markdown code blocks show the pattern) — not code.
]);

function walkTsx(dir: string, collected: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = resolve(dir, name);
    const s = statSync(abs);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walkTsx(abs, collected);
    } else if (name.endsWith(".tsx")) {
      collected.push(abs);
    }
  }
  return collected;
}

function listFiles(): string[] {
  const collected: string[] = [];
  for (const dir of ["app", "components"]) {
    walkTsx(resolve(ROOT, dir), collected);
  }
  return collected.map((abs) => abs.slice(ROOT.length + 1)).sort();
}

describe("popover placement contract (§ 3.9)", () => {
  const violations: string[] = [];

  for (const rel of listFiles()) {
    if (ALLOWLIST.has(rel)) continue;
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    const hasTop = /\btop-full\b/.test(src);
    const hasBottom = /\bbottom-full\b/.test(src);
    if (!hasTop && !hasBottom) continue;
    const hasFlipImport = /computePopoverSide/.test(src);
    const hasBothDirs = hasTop && hasBottom;
    if (!(hasFlipImport && hasBothDirs)) {
      violations.push(
        `${rel} uses ${hasTop ? "top-full" : ""}${hasTop && hasBottom ? "+" : ""}${
          hasBottom ? "bottom-full" : ""
        } but is missing ${
          hasFlipImport ? "" : "computePopoverSide import"
        }${!hasFlipImport && !hasBothDirs ? " and " : ""}${
          hasBothDirs ? "" : "the opposite-direction branch"
        }`,
      );
    }
  }

  it("every popover consumer wires computePopoverSide + ternary direction", () => {
    expect(violations).toEqual([]);
  });
});
