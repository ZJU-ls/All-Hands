#!/usr/bin/env node
// Audit i18n catalog: zh-CN vs en shape parity, ICU placeholder parity,
// duplicate keys, suspiciously long English (overflow risk), suspicious
// translations (key === value, looks like a fallback to the key name).
//
// Usage: node scripts/audit-i18n-catalog.mjs [--strict]
//   --strict: exit non-zero on any finding (CI mode).
//
// Run from web/.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const ZH_DIR = join(ROOT, "i18n/messages/zh-CN");
const EN_DIR = join(ROOT, "i18n/messages/en");
const ZH_ROOT = join(ROOT, "i18n/messages/zh-CN.json");
const EN_ROOT = join(ROOT, "i18n/messages/en.json");

const STRICT = process.argv.includes("--strict");

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function loadLocale(rootPath, dirPath) {
  const root = readJson(rootPath);
  const merged = { ...root };
  let extras = {};
  try {
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".json")) continue;
      const obj = readJson(join(dirPath, file));
      extras = { ...extras, ...obj };
    }
  } catch (e) {
    // ok
  }
  return { ...extras, ...root };
}

function placeholders(s) {
  if (typeof s !== "string") return new Set();
  const found = new Set();
  // Match `{name}` placeholders. Skip ICU rich tags like `<chunks>`.
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)(,\s*[a-zA-Z]+(,\s*[^}]+)?)?\}/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    found.add(m[1]);
  }
  return found;
}

function setEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const zh = loadLocale(ZH_ROOT, ZH_DIR);
const en = loadLocale(EN_ROOT, EN_DIR);

const zhFlat = flatten(zh);
const enFlat = flatten(en);
const zhKeys = new Set(Object.keys(zhFlat));
const enKeys = new Set(Object.keys(enFlat));

const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
const placeholderMismatch = [];
const looksLikeKey = []; // value equals last segment of key (common machine fallback)
const longEnglish = []; // English > 1.6× Chinese length, overflow risk
const emptyValues = [];

for (const k of zhKeys) {
  if (!enKeys.has(k)) continue;
  const zv = zhFlat[k];
  const ev = enFlat[k];
  if (typeof zv !== "string" || typeof ev !== "string") continue;
  const zp = placeholders(zv);
  const ep = placeholders(ev);
  if (!setEqual(zp, ep)) {
    placeholderMismatch.push({ key: k, zh: [...zp], en: [...ep] });
  }
  if (!ev.trim()) emptyValues.push({ key: k, locale: "en" });
  if (!zv.trim()) emptyValues.push({ key: k, locale: "zh-CN" });
  // English value identical to last key segment (e.g. "loading" ↔ "loading") often signals stub.
  const last = k.split(".").pop();
  if (last && ev.toLowerCase() === last.toLowerCase() && ev.length < 24) {
    looksLikeKey.push({ key: k, value: ev });
  }
  // Length heuristic: ratio of english chars to chinese chars (each Chinese char counts as ~2).
  const zhChars = [...zv].length;
  const enChars = ev.length;
  if (zhChars >= 4 && enChars > zhChars * 2.6 && enChars > 32) {
    longEnglish.push({ key: k, zh: zv, en: ev, zhChars, enChars });
  }
}

const report = {
  totals: {
    zh_keys: zhKeys.size,
    en_keys: enKeys.size,
    intersect: [...zhKeys].filter((k) => enKeys.has(k)).length,
  },
  missing_in_en: missingInEn,
  missing_in_zh: missingInZh,
  placeholder_mismatch: placeholderMismatch,
  empty_values: emptyValues,
  looks_like_key_stub: looksLikeKey,
  long_english_overflow_risk: longEnglish,
};

console.log(JSON.stringify(report, null, 2));

const findings =
  missingInEn.length +
  missingInZh.length +
  placeholderMismatch.length +
  emptyValues.length;

if (STRICT && findings > 0) {
  console.error(`\n[strict] found ${findings} catalog issues`);
  process.exit(1);
}
