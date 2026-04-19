/**
 * Regression test for I-0010 — no raw state literals in JSX text.
 *
 * After the sweep (see commit refactor(web): sweep raw Loading/Error/No-data…),
 * every `<p>加载中…</p>` / `<p>暂无数据</p>` style literal in app/** and
 * components/** must use <LoadingState />, <EmptyState />, or <ErrorState />
 * from web/components/state instead. The ESLint rule in .eslintrc.json is the
 * primary gate (`no-restricted-syntax` on JSXText); this vitest mirrors the
 * regex so CI catches regressions even if the ESLint config is bypassed.
 *
 * If you see this test fail, the fix is almost always:
 *    -  <p className="...">加载中…</p>
 *    +  <LoadingState title="加载 XYZ" />
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const APP = path.join(REPO, "app");
const COMPONENTS = path.join(REPO, "components");

/**
 * JSXText-level raw state literals. Mirrors the selector regex in
 * .eslintrc.json so this vitest is a lightweight CI mirror of the ESLint rule.
 *
 * Scope is intentionally JSX-text only (not string-literals anywhere): the
 * bug shape from I-0010 is `<p>加载中…</p>`-style inline literals. Attribute
 * forms like `<LoadingState title="加载 X" />` feed the state component, not
 * a raw literal — those are the fix, not the offense.
 */
const RAW_STATE_JSX_TEXT =
  />\s*(?:加载中…?|Loading\.\.\.|Loading…|暂无(?:数据|消息|活动)|No data\.?)\s*</;

const TSX = /\.tsx$/;

function walk(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) return walk(full, re);
    return re.test(name) ? [full] : [];
  });
}

function rel(p: string) {
  return path.relative(REPO, p);
}

// Allowlist mirrors .eslintrc.json `excludedFiles`:
// - design-lab is a multi-variant visual showcase; the literals appear as
//   intentional samples and documentation.
// - components/state/** are the replacements themselves.
// - test files exercise the literals in assertions.
function isAllowlisted(file: string): boolean {
  if (file.startsWith("app/design-lab/")) return true;
  if (file.startsWith("components/state/")) return true;
  if (/__tests__\//.test(file)) return true;
  if (/\.test\.(ts|tsx)$/.test(file)) return true;
  return false;
}

const allTsx = [...walk(APP, TSX), ...walk(COMPONENTS, TSX)];

describe("I-0010 · no raw Loading/Error/No-data literals in JSX", () => {
  it.each(allTsx.map((p) => [rel(p)]))(
    "%s has no bare state literal in JSXText / attribute",
    (file) => {
      if (isAllowlisted(file)) return;
      const src = readFileSync(path.join(REPO, file), "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!RAW_STATE_JSX_TEXT.test(line)) continue;
        // Per-line eslint-disable waiver is permitted (I-0010 DoD).
        if (/eslint-disable-next-line\s+no-restricted-syntax/.test(line)) continue;
        const prev = i > 0 ? lines[i - 1]! : "";
        if (/eslint-disable-next-line\s+no-restricted-syntax/.test(prev)) continue;
        throw new Error(
          `no-raw-state-literal · ${file}:${i + 1} — use <LoadingState />, <EmptyState />, <ErrorState /> from @/components/state instead:\n  ${line.trim()}`,
        );
      }
    },
  );

  it(".eslintrc.json registers the no-restricted-syntax JSXText rule", () => {
    const cfg = JSON.parse(
      readFileSync(path.join(REPO, ".eslintrc.json"), "utf8"),
    );
    const override = cfg.overrides?.find((o: { files?: string[] }) =>
      (o.files ?? []).some((f) => f.includes("app/**")),
    );
    expect(override, "expected .eslintrc.json override targeting app/**").toBeDefined();
    const rule = override?.rules?.["no-restricted-syntax"];
    expect(Array.isArray(rule)).toBe(true);
    const text = JSON.stringify(rule);
    expect(text).toMatch(/JSXText/);
    expect(text).toMatch(/加载中/);
    expect(text).toMatch(/暂无/);
    expect(text).toMatch(/Loading/);
  });
});
