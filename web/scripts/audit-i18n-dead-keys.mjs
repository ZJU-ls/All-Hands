#!/usr/bin/env node
/**
 * Find catalog keys that are never referenced from app/ + components/ + lib/.
 *
 * Pairs source-side `useTranslations("ns")` with each `t("subkey")` /
 * `` t(`prefix.${var}`) `` call and computes the set of (ns.subkey)
 * combinations actually used. Anything in the catalog that doesn't
 * appear here (literal nor template prefix) is flagged as dead.
 *
 * Heuristic — does NOT understand props-passed namespaces or computed
 * keys, so a small false-positive rate is expected. Use as a hint, not
 * an autodelete signal.
 *
 * Run:
 *     node web/scripts/audit-i18n-dead-keys.mjs           # summary
 *     node web/scripts/audit-i18n-dead-keys.mjs --list    # also print first 100
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "..");
const MSG = join(WEB, "i18n", "messages");

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    const s = statSync(f);
    if (s.isDirectory()) {
      if (e === "node_modules" || e === "__tests__") continue;
      out.push(...walk(f));
    } else if (/\.(tsx?|mts)$/.test(e) && !/\.test\./.test(e)) {
      out.push(f);
    }
  }
  return out;
}

function loadCatalog() {
  const keys = new Set();
  function visit(o, p) {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o)) {
        const next = [...p, k];
        if (typeof v === "string" || Array.isArray(v)) keys.add(next.join("."));
        else visit(v, next);
      }
    }
  }
  for (const f of [join(MSG, "zh-CN.json"), join(MSG, "en.json")]) {
    visit(JSON.parse(readFileSync(f, "utf8")), []);
  }
  for (const sub of ["zh-CN", "en"]) {
    const d = join(MSG, sub);
    try {
      for (const f of readdirSync(d)) {
        if (f.endsWith(".json")) visit(JSON.parse(readFileSync(join(d, f), "utf8")), []);
      }
    } catch {
      /* no per-namespace dir */
    }
  }
  return keys;
}

const cat = loadCatalog();
const used = new Set();
const usedPrefixes = new Set();
const declRe = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g;

for (const dir of ["app", "components", "lib"]) {
  for (const f of walk(join(WEB, dir))) {
    const src = readFileSync(f, "utf8");
    declRe.lastIndex = 0;
    const decls = [];
    let m;
    while ((m = declRe.exec(src))) decls.push({ name: m[1], ns: m[2] });
    for (const d of decls) {
      const litRe = new RegExp(`\\b${d.name}(?:\\.(?:rich|raw|has))?\\(\\s*"([a-zA-Z0-9_.]+)"`, "g");
      const tplRe = new RegExp(`\\b${d.name}(?:\\.(?:rich|raw|has))?\\(\\s*\`([a-zA-Z0-9_.]+)\\.\\$\\{`, "g");
      let mm;
      while ((mm = litRe.exec(src))) used.add(`${d.ns}.${mm[1]}`);
      while ((mm = tplRe.exec(src))) usedPrefixes.add(`${d.ns}.${mm[1]}`);
    }
  }
}

const dead = [];
for (const k of cat) {
  if (used.has(k)) continue;
  let prefixOk = false;
  const parts = k.split(".");
  for (let i = 1; i < parts.length; i++) {
    if (usedPrefixes.has(parts.slice(0, i).join("."))) {
      prefixOk = true;
      break;
    }
  }
  if (!prefixOk) dead.push(k);
}
dead.sort();

console.log(`catalog keys: ${cat.size}`);
console.log(`live (literal): ${used.size}`);
console.log(`live (template prefix): ${usedPrefixes.size}`);
console.log(`possibly dead: ${dead.length} (${(dead.length / cat.size * 100).toFixed(1)}%)`);
if (process.argv.includes("--list")) {
  for (const k of dead.slice(0, 100)) console.log("  ", k);
  if (dead.length > 100) console.log(`  …(+${dead.length - 100} more)`);
}
