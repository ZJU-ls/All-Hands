/**
 * i18n catalog · contract test.
 *
 * Runs the same checks as `scripts/audit-i18n-catalog.mjs` but inside vitest
 * so CI catches:
 *   - zh-CN ↔ en shape drift (key tree mismatches)
 *   - ICU placeholder mismatches between two locales for the same key
 *   - empty values
 *
 * If you legitimately add a key to zh-CN, also add it to en (or vice versa).
 * If you add a `{var}` placeholder on one side, mirror it on the other.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const ZH_DIR = join(ROOT, "i18n/messages/zh-CN");
const EN_DIR = join(ROOT, "i18n/messages/en");
const ZH_ROOT = join(ROOT, "i18n/messages/zh-CN.json");
const EN_ROOT = join(ROOT, "i18n/messages/en.json");

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function loadLocale(rootPath: string, dirPath: string): Record<string, unknown> {
  const root = readJson(rootPath);
  let extras: Record<string, unknown> = {};
  try {
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".json")) continue;
      Object.assign(extras, readJson(join(dirPath, file)));
    }
  } catch {
    // dir may not exist in fresh checkouts
  }
  return { ...extras, ...root };
}

function placeholders(s: unknown): Set<string> {
  if (typeof s !== "string") return new Set();
  const found = new Set<string>();
  // Match `{name}` or `{name, plural, …}` ICU placeholders. Skip rich tags.
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const name = m[1];
    if (name) found.add(name);
  }
  return found;
}

const zh = loadLocale(ZH_ROOT, ZH_DIR);
const en = loadLocale(EN_ROOT, EN_DIR);
const zhFlat = flatten(zh);
const enFlat = flatten(en);

describe("i18n catalog · zh-CN vs en", () => {
  it("has the same key tree on both locales", () => {
    const zhKeys = new Set(Object.keys(zhFlat));
    const enKeys = new Set(Object.keys(enFlat));
    const missingInEn: string[] = [];
    const missingInZh: string[] = [];
    for (const k of zhKeys) if (!enKeys.has(k)) missingInEn.push(k);
    for (const k of enKeys) if (!zhKeys.has(k)) missingInZh.push(k);
    expect(missingInEn, `zh-CN keys missing in en:\n  ${missingInEn.join("\n  ")}`).toEqual([]);
    expect(missingInZh, `en keys missing in zh-CN:\n  ${missingInZh.join("\n  ")}`).toEqual([]);
  });

  it("has matching ICU placeholders for every shared key", () => {
    const mismatches: string[] = [];
    for (const k of Object.keys(zhFlat)) {
      if (!(k in enFlat)) continue;
      const zp = placeholders(zhFlat[k]);
      const ep = placeholders(enFlat[k]);
      if (zp.size !== ep.size || [...zp].some((x) => !ep.has(x))) {
        mismatches.push(`${k}: zh={${[...zp].join(",")}} vs en={${[...ep].join(",")}}`);
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });

  it("has no empty string values on either side", () => {
    const empty: string[] = [];
    for (const [k, v] of Object.entries(zhFlat)) {
      if (typeof v === "string" && !v.trim()) empty.push(`zh-CN: ${k}`);
    }
    for (const [k, v] of Object.entries(enFlat)) {
      if (typeof v === "string" && !v.trim()) empty.push(`en: ${k}`);
    }
    expect(empty, empty.join("\n")).toEqual([]);
  });
});
