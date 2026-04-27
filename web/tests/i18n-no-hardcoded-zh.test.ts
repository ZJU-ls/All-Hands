/**
 * Regression net · live (non-comment) Chinese characters in `app/` and
 * `components/` source.
 *
 * Strips block / line / JSX comments and counts Chinese characters in what's
 * left. Anything found should go through `useTranslations`. A short allowlist
 * exists for legitimate non-translatable cases:
 *
 *   - regex literals matching Chinese brand keywords (BrandMark / PlanCard
 *     match `通义` / `百炼` / `批准` etc. — those identifiers ARE Chinese
 *     by nature, the regex must keep matching them).
 *
 * The current ceiling is set so a small number of regex-only files don't
 * fail the test, but new accidental hardcoded strings bump us over the cap.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SCAN_DIRS = ["app", "components"];

const ZH = /[一-鿿]/g;

// Files that legitimately contain Chinese characters in regex literals.
// Brand-name pattern matchers (`/通义/`, `/百炼/`) and Chinese action verbs
// in PlanCard (`/批准|同意/`).
const ALLOWLIST = new Set([
  "components/brand/BrandMark.tsx",
  "components/render/PlanCard.tsx",
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      yield* walk(full);
    } else if (stat.isFile() && /\.(tsx?|mts)$/.test(entry) && !/\.test\./.test(entry)) {
      yield full;
    }
  }
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function countLiveChinese(file: string): number {
  const src = readFileSync(file, "utf8");
  const stripped = stripComments(src);
  const matches = stripped.match(ZH);
  return matches?.length ?? 0;
}

describe("i18n · no hardcoded Chinese in source", () => {
  it("scans app/ and components/ for stray Chinese characters outside comments", () => {
    const offenders: { file: string; count: number }[] = [];
    for (const dir of SCAN_DIRS) {
      const root = join(ROOT, dir);
      for (const file of walk(root)) {
        const rel = file.slice(ROOT.length + 1);
        if (ALLOWLIST.has(rel)) continue;
        const n = countLiveChinese(file);
        if (n > 0) offenders.push({ file: rel, count: n });
      }
    }
    if (offenders.length > 0) {
      const lines = offenders
        .map(({ file, count }) => `  ${file}: ${count} chars`)
        .join("\n");
      throw new Error(
        `Found hardcoded Chinese strings in source — wrap them with useTranslations():\n${lines}`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
