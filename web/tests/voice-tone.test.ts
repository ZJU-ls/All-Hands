/**
 * I-0013 regression · Voice & Tone contract (03-visual-design.md §9.1).
 *
 * The UI copy must stay in lockstep with the Lead Agent's tone:
 *   - no decorative pictographic emoji (☀ ☾ 🔧 📊 ⚙ 💬 …)
 *   - no exclamation marks in Chinese copy
 *   - no 咱们 / 我们 (dilutes accountability)
 *   - banned low-information button labels
 *
 * Scans `web/app/**` + `web/components/**`. Tests, icon glyphs, and this
 * file itself are exempt. Mono single-char glyphs that the visual spec
 * explicitly allows (`→ ← ⌘ ↵ ✓ ✗ ✕ · …`) are whitelisted — the rule bans
 * pictographic emoji, not structured mono typography.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const APP = path.join(REPO, "app");
const COMPONENTS = path.join(REPO, "components");

function walk(dir: string, ext: RegExp, skip: RegExp[] = []): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (skip.some((r) => r.test(full))) return [];
    const s = statSync(full);
    if (s.isDirectory()) return walk(full, ext, skip);
    return ext.test(name) ? [full] : [];
  });
}

const TS_OR_TSX = /\.(ts|tsx)$/;
const SKIP = [/node_modules/, /\.next/, /\/tests\//, /\/icons\//];

const sources = [
  ...walk(APP, TS_OR_TSX, SKIP),
  ...walk(COMPONENTS, TS_OR_TSX, SKIP),
];

function rel(p: string) {
  return path.relative(REPO, p);
}

/** Strip comments + capture contents of string / template literals. */
function extractLiterals(src: string): string[] {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const out: string[] = [];
  const re = /(["'`])((?:\\.|(?!\1).)*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noLine)) !== null) {
    if (typeof m[2] === "string") out.push(m[2]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. No pictographic emoji in UI copy.
//    §2.5 explicitly allows mono typography glyphs; we whitelist them below.
// ---------------------------------------------------------------------------

const EMOJI = new RegExp(
  "[" +
    "\\u{1F300}-\\u{1F6FF}" + // misc symbols, pictographs, transport
    "\\u{1F900}-\\u{1F9FF}" + // supplemental
    "\\u{1FA00}-\\u{1FAFF}" + // extended
    "\\u{2600}-\\u{26FF}" +   // misc symbols (☀ ☾ ★ …)
    "\\u{2700}-\\u{27BF}" +   // dingbats
    "]",
  "gu",
);

// Single-char mono glyphs that the visual spec treats as structured typography,
// not as decorative emoji.
const MONO_GLYPH_WHITELIST = new Set([
  "→", "←", "↑", "↓",
  "⌘", "↵", "⎋",
  "·", "…",
  "✓", "✗", "✕",  // check/cross in mono status chips (render-lib parity)
]);

describe("I-0013 · no decorative emoji in UI copy", () => {
  it("every scanned file is emoji-free (mono glyphs excepted)", () => {
    const offenders: { file: string; glyphs: string[] }[] = [];
    for (const file of sources) {
      const src = readFileSync(file, "utf8");
      const literals = extractLiterals(src);
      const hits = literals.flatMap((s) => {
        const matches = s.match(EMOJI) ?? [];
        return matches.filter((g) => !MONO_GLYPH_WHITELIST.has(g));
      });
      if (hits.length > 0) offenders.push({ file: rel(file), glyphs: Array.from(new Set(hits)) });
    }
    expect(
      offenders,
      `pictographic emoji in UI copy (use §2.7 icon set instead):\n` +
        offenders.map((o) => `  ${o.file}: ${o.glyphs.join(" ")}`).join("\n"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. No exclamation marks in zh-CN UI copy.
// ---------------------------------------------------------------------------

const HAS_CJK = /[\u4E00-\u9FFF]/;

describe("I-0013 · no exclamation in Chinese UI copy", () => {
  it("Chinese copy ends with 。 not !", () => {
    const offenders: { file: string; strings: string[] }[] = [];
    for (const file of sources) {
      const src = readFileSync(file, "utf8");
      const hits = extractLiterals(src).filter(
        (s) => HAS_CJK.test(s) && (s.includes("!") || s.includes("!")),
      );
      if (hits.length > 0) offenders.push({ file: rel(file), strings: hits });
    }
    expect(
      offenders,
      `'!' in Chinese copy (rewrite as '。' statement):\n` +
        offenders
          .map((o) => `  ${o.file}: ${o.strings.map((s) => JSON.stringify(s)).join(", ")}`)
          .join("\n"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Pronoun discipline: 我 / 你, never 咱们 / 我们.
// ---------------------------------------------------------------------------

const FORBIDDEN_PRONOUNS = ["咱们", "我们"];

describe("I-0013 · pronoun discipline", () => {
  it("uses 我/你, not 咱们/我们", () => {
    const offenders: { file: string; strings: string[] }[] = [];
    for (const file of sources) {
      const src = readFileSync(file, "utf8");
      const hits = extractLiterals(src).filter((s) =>
        FORBIDDEN_PRONOUNS.some((p) => s.includes(p)),
      );
      if (hits.length > 0) offenders.push({ file: rel(file), strings: hits });
    }
    expect(
      offenders,
      `forbidden pronouns (rewrite as 我/你):\n` +
        offenders
          .map((o) => `  ${o.file}: ${o.strings.map((s) => JSON.stringify(s)).join(", ")}`)
          .join("\n"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Banned low-information button labels.
// ---------------------------------------------------------------------------

const BANNED_BUTTON_LABELS = new Set(["确定", "OK", "提交"]);

describe("I-0013 · button labels are verb-first", () => {
  it("no 确定 / OK / 提交 as button text", () => {
    const button = /<button[^>]*>([^<]{1,20})<\/button>/g;
    const offenders: { file: string; labels: string[] }[] = [];
    for (const file of sources) {
      const src = readFileSync(file, "utf8");
      const hits: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = button.exec(src)) !== null) {
        const label = (m[1] ?? "").trim();
        if (BANNED_BUTTON_LABELS.has(label)) hits.push(label);
      }
      if (hits.length > 0) offenders.push({ file: rel(file), labels: hits });
    }
    expect(
      offenders,
      `banned button text (use verb-object like "发布" / "删除员工"):\n` +
        offenders.map((o) => `  ${o.file}: ${o.labels.join(", ")}`).join("\n"),
    ).toEqual([]);
  });
});
